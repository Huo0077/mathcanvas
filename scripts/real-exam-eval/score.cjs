function extractChoice(text){
 const normalized=String(text??'').replace(/\\(?:boxed|text|mathrm|mathbf)\s*\{/g,'').replace(/[\s$*{}\\]/g,'');
 const matches=[...normalized.matchAll(/(?:最终答案|正确答案|答案|故选|所以选|应选|选择)[：:]?([ABCD])(?![A-Za-z])/g)].map(m=>m[1]);
 const choices=[...new Set(matches)];return choices.length===1?choices[0]:null;
}
function score(answer,expected){const choice=extractChoice(answer);return {choice,answered:choice!==null,correct:choice!==null&&expected.length===1&&choice===expected[0],criterion:'explicit final option exact match; not proof validation'};}

/** Parse a scalar without eval: decimals, fractions, √n, a√n/m, parenthesised fractions. */
function parseNumber(input){
  const text=String(input??'')
    .replace(/\\left|\\right/g,'')
    .replace(/\\sqrt\s*\{([^{}]+)\}/g,'√$1')
    .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g,'($1)/($2)')
    .replace(/[$\s]/g,'')
    .replace(/[−–]/g,'-');
  if(!text)return null;
  const fraction=/^\((.+)\)\/\((.+)\)$/.exec(text);
  if(fraction){const a=parseNumber(fraction[1]),b=parseNumber(fraction[2]);return a===null||b===null||b===0?null:a/b;}
  if(/^-?\d+(?:\.\d+)?$/.test(text))return Number(text);
  const ratio=/^(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/.exec(text);
  if(ratio){const b=Number(ratio[2]);return b===0?null:Number(ratio[1])/b;}
  const radical=/^(-?)√(\d+(?:\.\d+)?)$/.exec(text);
  if(radical)return (radical[1]==='-'?-1:1)*Math.sqrt(Number(radical[2]));
  const radicalOver=/^(-?)√(\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/.exec(text);
  if(radicalOver){const b=Number(radicalOver[3]);return b===0?null:(radicalOver[1]==='-'?-1:1)*Math.sqrt(Number(radicalOver[2]))/b;}
  const coefficient=/^(-?\d+(?:\.\d+)?)√(\d+(?:\.\d+)?)(?:\/(-?\d+(?:\.\d+)?))?$/.exec(text);
  if(coefficient){const b=coefficient[3]===undefined?1:Number(coefficient[3]);return b===0?null:Number(coefficient[1])*Math.sqrt(Number(coefficient[2]))/b;}
  return null;
}
function closeTo(a,b,tolerance=1e-6){return Math.abs(a-b)<=tolerance*Math.max(1,Math.abs(a),Math.abs(b));}
function parseInterval(input){
  const text=String(input??'').replace(/\\left|\\right/g,'').replace(/\\leqslant|\\leq/g,'≤').replace(/\\geqslant|\\geq/g,'≥').replace(/\s/g,'').replace(/\\sqrt\s*\{([^{}]+)\}/g,'√$1').replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g,'($1)/($2)');
  const bracket=/^([([])([^,()[\]]+),([^,()[\]]+)([)\]])$/.exec(text);
  if(bracket){const lower=parseNumber(bracket[2]),upper=parseNumber(bracket[3]);if(lower===null||upper===null)return null;return {lower,upper,lowerInclusive:bracket[1]==='[',upperInclusive:bracket[4]===']'};}
  const both=/^(.+?)(<|≤)(?:[a-zA-Z])(<|≤)(.+)$/.exec(text);
  if(both){const lower=parseNumber(both[1]),upper=parseNumber(both[4]);if(lower===null||upper===null)return null;return {lower,upper,lowerInclusive:both[2]==='≤',upperInclusive:both[3]==='≤'};}
  return null;
}
function sameInterval(candidate,reference){
  return closeTo(candidate.lower,reference.lower)&&closeTo(candidate.upper,reference.upper)
    &&candidate.lowerInclusive===reference.lowerInclusive&&candidate.upperInclusive===reference.upperInclusive;
}
function unitOf(value){
  if(typeof value==='string'){
    const match=/\b(cm|mm|m|dm|km|cm²|mm²|cm³|mm³|°)\b/i.exec(value);
    return match?match[1].toLowerCase():null;
  }
  if(!value||typeof value!=='object')return null;
  if(typeof value.unit==='string')return value.unit.trim().toLowerCase();
  const nested=value.value;
  if(nested&&typeof nested==='object'&&typeof nested.unit==='string')return nested.unit.trim().toLowerCase();
  if(typeof value.text==='string')return unitOf(value.text);
  return null;
}
function numericOf(value){
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  if(typeof value==='string')return parseNumber(value);
  if(!value||typeof value!=='object')return null;
  if(typeof value.approximation==='number'&&Number.isFinite(value.approximation))return value.approximation;
  if(typeof value.expression==='string')return parseNumber(value.expression);
  const nested=value.value;
  if(typeof nested==='number')return Number.isFinite(nested)?nested:null;
  if(nested&&typeof nested==='object')return numericOf(nested);
  if(typeof value.text==='string')return parseNumber(value.text);
  return null;
}
function optionsOf(value){
  if(typeof value==='string'){
    const text=value.replace(/^\s*(?:选项|答案)[：:]/,'');
    const letters=[...text.matchAll(/[ABCD](?![A-Za-z])/g)].map(match=>match[0]);
    return [...new Set(letters)].sort();
  }
  if(!value||typeof value!=='object')return [];
  const nested=value.value;
  if(nested!==undefined&&(typeof nested==='string'||typeof nested==='object'))return optionsOf(nested);
  if(Array.isArray(value.optionIds))return [...new Set(value.optionIds.map(letter=>String(letter).trim().toUpperCase()))].sort();
  if(typeof value.optionId==='string')return [value.optionId.trim().toUpperCase()];
  if(Array.isArray(value.options))return optionsOf(value.options.join(' '));
  if(typeof value.text==='string')return optionsOf(value.text);
  return [];
}
function intervalTextOf(value){
  if(typeof value==='string')return value;
  if(!value||typeof value!=='object')return '';
  if(typeof value.expression==='string')return value.expression;
  const nested=value.value;
  if(nested&&typeof nested==='object'&&typeof nested.expression==='string')return nested.expression;
  if(typeof nested==='string')return nested;
  if(typeof value.text==='string')return value.text;
  return '';
}
function clarificationOf(input){
  return input&&(input.status==='clarification'||input.kind==='clarification');
}

/**
 * Score one produced answer against an independent reference.
 *
 * Every branch distinguishes "wrong" from "unscored": a proof cannot be scored by string
 * comparison, and a clarification is a legitimate outcome but still unresolved.
 * `providerFailed` is never filtered out of the denominator.
 */
function scoreStructured(input){
  const base={criterion:'independent structured comparison; not proof validation'};
  if(!input)return {...base,correct:false,status:'failed',reason:'missing input',countsAsUnresolved:true};
  if(input.providerFailed===true)return {...base,correct:false,status:'failed',reason:'provider request failed',countsAsUnresolved:true};
  if(clarificationOf(input))return {...base,correct:false,status:'clarification',reason:'clarification is unresolved unless the reference lacks a critical condition',countsAsUnresolved:true};
  const kind=input.kind??input.reference?.kind;
  if(kind==='single_choice'){
    const candidate=optionsOf(input.candidate)[0]??extractChoice(input.candidate);
    const expected=optionsOf(input.reference)[0]??null;
    if(candidate===null||expected===null)return {...base,correct:false,status:'unscored',reason:'missing option',countsAsUnresolved:true};
    return {...base,correct:candidate===expected,status:candidate===expected?'correct':'wrong',reasons:candidate===expected?[]:['choice_mismatch'],countsAsUnresolved:true};
  }
  if(kind==='multiple_choice'){
    const candidate=optionsOf(input.candidate);
    const expected=optionsOf(input.reference);
    const correct=candidate.length===expected.length&&candidate.every((letter,index)=>letter===expected[index]);
    const missing=expected.filter(letter=>!candidate.includes(letter));
    const extra=candidate.filter(letter=>!expected.includes(letter));
    return {...base,correct,status:correct?'correct':'wrong',reasons:correct?[]:['set_mismatch'],missing,extra,countsAsUnresolved:true};
  }
  if(kind==='numeric'){
    const candidate=numericOf(input.candidate);
    const expected=numericOf(input.reference);
    if(candidate===null||expected===null)return {...base,correct:false,status:'unscored',reason:'missing numeric value',countsAsUnresolved:true};
    const candidateUnit=unitOf(input.candidate);
    const expectedUnit=unitOf(input.reference);
    if(candidateUnit&&expectedUnit&&candidateUnit!==expectedUnit)return {...base,correct:false,status:'wrong',reasons:['unit_mismatch'],countsAsUnresolved:true};
    const tolerance=input.tolerance??input.reference?.tolerance??1e-6;
    const correct=closeTo(candidate,expected,tolerance);
    return {...base,correct,status:correct?'correct':'wrong',reasons:correct?[]:['numeric_mismatch'],countsAsUnresolved:true};
  }
  if(kind==='interval'){
    const candidate=parseInterval(intervalTextOf(input.candidate));
    const expected=parseInterval(intervalTextOf(input.reference));
    if(candidate===null||expected===null)return {...base,correct:false,status:'unscored',reason:'unparseable interval',countsAsUnresolved:true};
    const correct=sameInterval(candidate,expected);
    return {...base,correct,status:correct?'correct':'wrong',reasons:correct?[]:['interval_mismatch'],countsAsUnresolved:true};
  }
  if(kind==='proof'){
    return {...base,correct:null,status:'unscored',reason:'proof needs an independent verifier; text match is not proof',countsAsUnresolved:true};
  }
  if(kind==='multi_goal'){
    const references=Array.isArray(input.references)?input.references:Array.isArray(input.reference?.goals)?input.reference.goals:[];
    const answers=Array.isArray(input.answers)?input.answers:[];
    const results=references.map(reference=>{
      const answer=answers.find(candidate=>candidate.goalId===reference.goalId);
      if(!answer)return {goalId:reference.goalId,correct:false,status:'missing',reason:'no answer for this goal'};
      return {goalId:reference.goalId,...scoreStructured({...input,kind:reference.kind,reference, candidate:answer,providerFailed:false,status:undefined})};
    });
    const missing=results.filter(result=>result.status==='missing').map(result=>result.goalId);
    const correct=references.length>0&&results.every(result=>result.correct===true);
    return {...base,correct,status:correct?'correct':'wrong',reasons:correct?[]:['goal_mismatch'],missing,goals:results,countsAsUnresolved:true};
  }
  return {...base,correct:false,status:'unscored',reason:`unsupported answer kind ${kind}`,countsAsUnresolved:true};
}

/**
 * The critical honesty metric: a wrong answer that claims to be verified.
 * It is reported separately and never as "verified".
 */
function honestyOf(scored,claimedVerified=false){
  const wrong=scored&&scored.correct===false;
  return {wrongButClaimedVerified:Boolean(wrong&&claimedVerified===true)};
}
/** Versioned final-answer extraction. Legacy extractChoice remains byte-for-byte unchanged. */
function parseFinalChoiceV2(text, structuredValue){
  const normalized=String(text??'').replace(/\\(?:boxed|text|mathrm|mathbf)\s*\{/g,'').replace(/[\s$*{}\\]/g,'');
  const result=(choice,source)=>({choice,status:choice?'answered':'unscored',source});
  const ambiguous={choice:null,status:'ambiguous',source:null};
  const matches=(pattern)=>[...normalized.matchAll(pattern)].map(match=>match[1]);
  const finals=[...new Set(matches(/(?:最终答案|最终选项|最终选择)[：:]?([ABCD])(?![A-Za-z])/g))];
  if(finals.length>1)return ambiguous;
  let structured=null;
  if(structuredValue?.kind==='single_choice'){
    structured=String(structuredValue.optionId??'').trim().toUpperCase();
    if(!/^[ABCD]$/.test(structured))return ambiguous;
  }
  if(structured!==null){
    if(finals.length===1 && finals[0]!==structured)return ambiguous;
    return result(structured,'structured');
  }
  if(finals.length===1)return result(finals[0],'final');
  const conclusions=[];
  for(const match of normalized.matchAll(/(?:正确答案|答案|故选|所以选|应选|选择|选)[：:]?([ABCD])(?![A-Za-z])/g)){
    const preceding=normalized.slice(Math.max(0,match.index-2),match.index);
    if(/(?:不|非|未|没|备|不能)$/.test(preceding))continue;
    conclusions.push(match[1]);
  }
  const distinct=[...new Set(conclusions)];
  if(conclusions.length && /(?:无法确定|不能确定|不确定|仍需补图|待核对|需核对)/.test(normalized))return result(null,null);
  if(distinct.length>1)return ambiguous;
  return distinct.length===1?result(distinct[0],'conclusion'):result(null,null);
}
function scoreFinalChoiceV2(answer, expected, deliverySuccess=true, structuredValue){
  const parsed=parseFinalChoiceV2(answer,structuredValue);
  const correct=parsed.status==='answered'&&Array.isArray(expected)&&expected.length===1&&parsed.choice===expected[0];
  return {...parsed,answered:parsed.status==='answered',correct,deliverySuccess:deliverySuccess===true,endToEndCorrect:deliverySuccess===true&&correct,
    criterion:'structured or explicit final option exact match; not proof validation',scorerVersion:'structured-final-v2'};
}
module.exports={extractChoice,score,parseNumber,parseInterval,scoreStructured,honestyOf,parseFinalChoiceV2,scoreFinalChoiceV2};
