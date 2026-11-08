const {test}=require('node:test');const assert=require('node:assert/strict');const {extractChoice,score,parseNumber,scoreStructured,honestyOf}=require('./score.cjs');
test('explicit final choice',()=>assert.equal(extractChoice('推导。最终答案：C'),'C'));
test('latex bold choice',()=>assert.equal(extractChoice('最终答案：$\\boxed{B}$'),'B'));
test('standard Chinese conclusion',()=>assert.equal(extractChoice('故选：D。'),'D'));
test('do not guess from enumerated options',()=>assert.equal(extractChoice('A.1 B.2 C.3 D.4'),null));
test('unanswered is not correct',()=>assert.equal(score('', ['A']).correct,false));
test('wrong option is wrong',()=>assert.equal(score('最终答案：B',['C']).correct,false));
test('no substring contamination',()=>assert.equal(extractChoice('分析ABC三点，答案尚待确定'),null));
test('conflicting conclusions require review',()=>assert.equal(extractChoice('答案：A。最终答案：C'),null));
test('matching answer correct',()=>assert.equal(score('所以选B',['B']).correct,true));

// W8: structured scoring must be independent of presentation order and notation.
test('scalar parser handles fractions and radicals without eval',()=>{
 assert.equal(Number(parseNumber('\\sqrt{2}/2').toFixed(9)),Number((Math.SQRT2/2).toFixed(9)));
 assert.equal(parseNumber('2√5/5'),Number((2*Math.sqrt(5)/5)));
});
test('multi-select order does not matter',()=>{
 const scored=scoreStructured({kind:'multiple_choice',candidate:{optionIds:['C','A']},reference:{optionIds:['A','C']}});
 assert.equal(scored.correct,true);
});
test('multi-select missing one member is wrong and reports it',()=>{
 const scored=scoreStructured({kind:'multiple_choice',candidate:{optionIds:['A']},reference:{optionIds:['A','C']}});
 assert.equal(scored.correct,false);
 assert.deepEqual(scored.missing,['C']);
});
test('interval endpoint inclusivity is part of the answer',()=>{
 const right=scoreStructured({kind:'interval',candidate:{expression:'0<e≤\\sqrt{2}/2'},reference:{expression:'(0,\\sqrt{2}/2]'}});
 assert.equal(right.correct,true);
 const wrong=scoreStructured({kind:'interval',candidate:{expression:'0<e<\\sqrt{2}/2'},reference:{expression:'(0,\\sqrt{2}/2]'}});
 assert.equal(wrong.correct,false);
});
test('exact and decimal forms are equivalent within tolerance',()=>{
 assert.equal(scoreStructured({kind:'numeric',candidate:'2/3',reference:0.6666667}).correct,true);
 assert.equal(scoreStructured({kind:'numeric',candidate:'2/3',reference:0.66}).correct,false);
});
test('units are compared, not ignored',()=>{
 assert.equal(scoreStructured({kind:'numeric',candidate:{value:5,unit:'mm'},reference:{value:5,unit:'cm'}}).correct,false);
 assert.equal(scoreStructured({kind:'numeric',candidate:{value:5,unit:'cm'},reference:{value:5,unit:'cm'}}).correct,true);
});
test('a missing sub-question makes the whole item wrong',()=>{
 const scored=scoreStructured({kind:'multi_goal',answers:[{goalId:'g1',kind:'numeric',candidate:'2'}],references:[{goalId:'g1',kind:'numeric',value:2},{goalId:'g2',kind:'numeric',value:3}]});
 assert.equal(scored.correct,false);
 assert.deepEqual(scored.missing,['g2']);
});
test('a clarification is unresolved, not correct',()=>{
 const scored=scoreStructured({status:'clarification'});
 assert.equal(scored.correct,false);
 assert.equal(scored.countsAsUnresolved,true);
});
test('a failed provider request stays in the denominator',()=>{
 const scored=scoreStructured({providerFailed:true});
 assert.equal(scored.status,'failed');
 assert.equal(scored.countsAsUnresolved,true);
});
test('wrong but claimed verified is reported separately',()=>{
 const scored=scoreStructured({kind:'single_choice',candidate:'B',reference:'C'});
 assert.equal(scored.correct,false);
 assert.equal(honestyOf(scored,true).wrongButClaimedVerified,true);
 assert.equal(honestyOf(scoreStructured({kind:'single_choice',candidate:'C',reference:'C'}),true).wrongButClaimedVerified,false);
});
test('proof matching is unscored, never correct or wrong',()=>{
 const scored=scoreStructured({kind:'proof',candidate:'证明见上',reference:'证明见上'});
 assert.equal(scored.correct,null);
 assert.equal(scored.status,'unscored');
});
