### 基于redis 的分布式定时器


使用:
```js
const dschedule = require("distributed-schedule");


let schedule = new dschedule({
    host: "127.0.0.1",
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

```