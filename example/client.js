
const redisSchedule = require("../index.js");


let schedule = new redisSchedule({
    host: "0.0.0.0",
    port: 6379,
    db: 3
})

schedule.defined('function_1', async function () {
    console.log("function 1");
})

schedule.defined('function_2', async function () {
    console.log("function 2");
})

schedule.register('*/2 * * * * *', 'function_1')
schedule.register('*/2 * * * * *', 'function_2')