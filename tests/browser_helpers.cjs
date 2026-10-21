const {spawn,execFileSync} = require('node:child_process');
const http=require('node:http'),https=require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
exports.startServer = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'klassenbuch-qa-'));
  const process = spawn(global.process.env.PYTHON_BIN || 'python3', [path.join(__dirname,'../server.py'),'--bind','127.0.0.1','--port','0','--data-dir',directory], {stdio:['ignore','pipe','pipe']});
  let logs = '';
  process.stderr.on('data', chunk => logs += chunk);
  let url = await new Promise((resolve,reject) => {
    const timeout = setTimeout(()=>reject(Error('Testserver start timeout: '+logs)),10000);
    process.stdout.on('data',chunk=>{
      const match=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);
      if(match){clearTimeout(timeout);resolve(match[0]);}
    });
    process.once('exit',code=>{clearTimeout(timeout);reject(Error('Testserver exited '+code+': '+logs));});
  });
  let proxy;
  if (global.process.env.TEST_HTTPS) {
    const keyFile=path.join(directory,'test-key.pem'),certFile=path.join(directory,'test-cert.pem');
    execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyFile,'-out',certFile,'-days','1','-subj','/CN=localhost'],{stdio:'ignore'});
    const upstream=url;
    proxy=https.createServer({key:fs.readFileSync(keyFile),cert:fs.readFileSync(certFile)},(req,res)=>{
      const target=http.request(upstream+req.url,{method:req.method,headers:req.headers},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
      target.on('error',()=>{res.writeHead(502);res.end();});req.pipe(target);
    });
    await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
    url='https://127.0.0.1:'+proxy.address().port;
  }
  return {url,directory,setup:()=>fs.readFileSync(path.join(directory,'setup-token'),'utf8').trim(),stop:async()=>{
    if(proxy){proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));}
    await new Promise(resolve=>{process.once('exit',resolve);process.kill('SIGTERM');});
    fs.rmSync(directory,{recursive:true,force:true});
  }};
};
