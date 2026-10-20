// Optional asset generation; Playwright + Chromium required only for this step.
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async()=>{
 const root=path.join(__dirname,'../dist'),svg=fs.readFileSync(path.join(root,'logo.svg'),'utf8');
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const page=await browser.newPage();
  for(const [name,size,maskable] of [['icon-192.png',192,false],['icon-512.png',512,false],['icon-maskable-512.png',512,true],['apple-touch-icon.png',180,true]]){
   const source=maskable?svg.replace('rx="112"','rx="0"'):svg;
   const data=await page.evaluate(async({source,size})=>{
    const image=new Image();image.src='data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(source)));await image.decode();
    const canvas=document.createElement('canvas');canvas.width=canvas.height=size;canvas.getContext('2d').drawImage(image,0,0,size,size);return canvas.toDataURL('image/png').split(',')[1];
   },{source,size});
   fs.writeFileSync(path.join(root,name),Buffer.from(data,'base64'));
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
