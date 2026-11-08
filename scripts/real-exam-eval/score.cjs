function extractChoice(text){
 const normalized=String(text??'').replace(/\\(?:boxed|text|mathrm|mathbf)\s*\{/g,'').replace(/[\s$*{}\\]/g,'');
 const matches=[...normalized.matchAll(/(?:最终答案|正确答案|答案|故选|所以选|应选|选择)[：:]?([ABCD])(?![A-Za-z])/g)].map(m=>m[1]);
 const choices=[...new Set(matches)];return choices.length===1?choices[0]:null;
}
function score(answer,expected){const choice=extractChoice(answer);return {choice,answered:choice!==null,correct:choice!==null&&expected.length===1&&choice===expected[0],criterion:'explicit final option exact match; not proof validation'};}
module.exports={extractChoice,score};
