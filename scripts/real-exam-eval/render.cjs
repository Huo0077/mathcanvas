const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
(async () => {
 const root=process.cwd(),dir=path.join(root,'test-fixtures/real-exams-20261105');
 const cases=JSON.parse(fs.readFileSync(path.join(dir,'cases.json'),'utf8'));
 const browser=await chromium.launch({headless:true,channel:"msedge"});
 const page=await browser.newPage({viewport:{width:1300,height:1600},deviceScaleFactor:1});
 for(const q of cases.filter(q=>q.images.length && (!process.env.MATHCANVAS_REAL_EXAM_IDS || process.env.MATHCANVAS_REAL_EXAM_IDS.split(",").includes(q.id)))){
  await page.setContent('<html><meta charset="utf-8"><style>body{margin:0;background:white}#sheet{padding:24px;width:1200px;font:24px/1.6 "Microsoft YaHei",sans-serif;color:black;box-sizing:border-box}#text{white-space:pre-wrap;overflow-wrap:anywhere}#imgs{display:flex;flex-wrap:wrap;gap:18px;align-items:flex-start}figure{margin:10px}img{max-width:1100px;image-rendering:auto}figcaption{font-size:22px}</style><div id="sheet"><div id="text"></div><div id="imgs"></div></div></html>');
  await page.locator('#text').evaluate((el,text)=>el.textContent=text,q.question);
  for(let i=0;i<q.images.length;i++){
   const png=fs.readFileSync(path.join(root,q.images[i].file)).toString('base64');
   const optionsFirst=['mm-000','mm-012','mm-058'].includes(q.id);
   const label=optionsFirst?(i<4?'选项 '+String.fromCharCode(65+i):'题图'):q.images.length===5?(i===0?'题图':'选项 '+String.fromCharCode(64+i)):q.images.length===4?'选项 '+String.fromCharCode(65+i):'题图 '+(i+1);
   await page.locator('#imgs').evaluate((el,{png,label})=>{const f=document.createElement('figure');const c=document.createElement('figcaption');c.textContent=label;const img=new Image();img.src='data:image/png;base64,'+png;f.append(c,img);el.append(f)}, {png,label});
  }
  await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));
  const file=path.join(dir,'images',q.id+'-sheet.png');await page.locator('#sheet').screenshot({path:file});
  q.sheet=path.relative(root,file).replaceAll('\\','/');
 }
 fs.writeFileSync(path.join(dir,'cases.json'),JSON.stringify(cases,null,2));
 await browser.close(); console.log('Rendered requested question sheets using unchanged source text and source images.');
})();
