const Koa = require('./lib/application')

let app = new Koa()


/**如果用 generator 函数会弹出一条警告 application:108 */ 

// app.use(function *(next){
//     if(this.path == "/favicon.ico"){
//         return
//     }
//     console.log(1);
//     yield next
//     console.log(2);
// })  

//这里使用具名函数是为了方便查看debug时候的效果 application:115
app.use(async function my_name (ctx,next) {
    if(ctx.path == "/favicon.ico"){
        return
    }    
    ctx.inspect()
    console.log(1);
    await next()
    console.log(2);
})

app.use(async (ctx,next) => {
    console.log(3);
    ctx.body = {
        status:206
    }
    await next()
    console.log(ctx.inspect());
    console.log(4);
})  

app.listen(3000)