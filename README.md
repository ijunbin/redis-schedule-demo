### 基于redis 的分布式定时器


使用:
```js
const redisSchedule = require("../index.js");
const moment = require('moment');



(async function () {

    let schedule = new redisSchedule({
        host: "0.0.0.0",
        port: 6379,
        db: 3
    })

    // 定义组名
    schedule.setGroupName('testGroup');
    // 定义定时任务
    schedule.defined('function_1', async function () {
        console.log("function 1", moment().format('YYYY-MM:DD HH:mm:ss'));
    })

    schedule.defined('function_2', async function () {
        console.log("function 2", moment().format('YYYY-MM:DD HH:mm:ss'));
    })
    // 注册定时任务
    await schedule.register('*/5 * * * * *', 'function_1')
    await schedule.register('*/5 * * * * *', 'function_2')
    
    // 接收回调通知
    await schedule.start();
})()

```