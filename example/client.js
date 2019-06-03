
const redisSchedule = require("../index.js");
const moment = require('moment');

let schedule = new redisSchedule({
    host: "0.0.0.0",
    port: 6379,
    db: 3
})

schedule.defined('function_1', async function () {
    console.log("function 1",moment().format('YYYY-MM:DD hh:mm:ss'));
    
})

schedule.defined('function_2', async function () {
    console.log("function 2",moment().format('YYYY-MM:DD hh:mm:ss'));
})

schedule.register('*/2 * * * * *', 'function_1')
schedule.register('*/5 * * * * *', 'function_2')