const express = require('express');
const bodyParser = require('body-parser');
const {literal} = require("sequelize");
const {Op} = require("sequelize");
const {sequelize} = require('./model')
const {getProfile} = require('./middleware/getProfile')
const app = express();
app.use(bodyParser.json());
app.set('sequelize', sequelize)
app.set('models', sequelize.models)

/**
 * FIX ME!
 * @returns contract by id
 */
app.get('/contracts/:id', getProfile, async (req, res) => {
    const {Contract} = req.app.get('models')
    const {id: contractId} = req.params
    const contract = await Contract.findOne({where: {id: contractId}})
    if (!contract) return res.status(404).end()
    // if the profile is not allowed with this contract / client id
    if (contract.ClientId != req.profile.id && contract.ContractorId != req.profile.id) return res.status(403).end()
    res.json(contract)
})

app.get('/contracts/', getProfile, async (req, res) => {
    const {Contract} = req.app.get('models')
    const profileId = req.profile.id
    const contracts = await Contract.findAll({
        where: {
            [Op.or]: [
                {ContractorId: profileId},
                {ClientId: profileId}
            ],
            status: {[Op.not]: "terminated"}
        }
    })

    res.json(contracts)
})


app.get('/jobs/unpaid', getProfile, async (req, res) => {
    const {Contract, Job} = req.app.get('models')
    const profileId = req.profile.id

    // as DB value for field "paid" is wrong and null value instead of false was entered i added the support for both cases
    const jobs = await Job.findAll({
        where: {
            [Op.or]: [
                {paid: false},
                {paid: null}
            ],


        },

        include: [{
            model: Contract,
            attributes: [],
            require: true,
            where: {
                [Op.or]: [
                    {ContractorId: profileId},
                    {ClientId: profileId}
                ],
                status: "in_progress"
            }
        }]


    })

    res.json(jobs)
})


app.get('/jobs/:job_id/pay', getProfile, async (req, res) => {
    const {Contract, Job, Profile} = req.app.get('models')
    const profileId = req.profile.id
    const job = await Job.findOne({where: {id: req.params.job_id}, include: [Contract]})

    // no job like it
    if (!job) return res.status(404).end()
    // make sure its the right client
    if (job.Contract.ClientId != req.profile.id) return res.status(403).end()
    // if we should progress
    if (job.paid) return res.status(422).end("job was already paid")
    // check that the client has funds to pay for this contract
    if (req.profile.balance < job.price) return res.status(422).end("insufficient funds")

    // should implement in one transaction
    // 1) add the job price to contractor balance
    // 2)  reduce job price from client
    // 3) change job status to paid

    await Profile.update(
        {balance: literal(`balance+${job.price}`)},
        {where: {id: job.Contract.ContractorId}}
    )

    req.profile.balance -= job.price
    await req.profile.save()

    job.paid = true;
    job.paymentDate = new Date()
    await job.save()

    res.json("Ok")
})


module.exports = app;
