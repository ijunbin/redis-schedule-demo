
const redisSchedule = require("../index.js");
const moment = require('moment');



(async function () {

    let schedule = new redisSchedule({
        host: "0.0.0.0",
        port: 6379,
        db: 3
    })

    schedule.setGroupName('testGroup');
    
    schedule.defined('function_1', async function () {
        console.log("function 1", moment().format('YYYY-MM:DD HH:mm:ss'));
    })

    schedule.defined('function_2', async function () {
        console.log("function 2", moment().format('YYYY-MM:DD HH:mm:ss'));
    })

    await schedule.register('*/5 * * * * *', 'function_1')
    // await schedule.register('*/5 * * * * *', 'function_2')
    await schedule.start();
})()