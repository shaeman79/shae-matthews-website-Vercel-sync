const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync(require.resolve('../api/lead.js'),'utf8');
async function invoke(responses,body={name:'Synthetic Test',email:'test@example.invalid',phone:'test-only'},method='POST'){
 const calls=[];const mod={exports:{}};const sandbox={module:mod,process:{env:{ZOHO_CLIENT_ID:'test',ZOHO_CLIENT_SECRET:'test',ZOHO_REFRESH_TOKEN:'test',ZOHO_CAMPAIGNS_LIST_KEY:'test'}},URLSearchParams,Date,console:{error(){}},fetch:async(url,opts)=>{calls.push({url,opts});const r=responses.shift();if(r instanceof Error)throw r;return {ok:r.ok!==false,status:r.status||200,json:async()=>r.data,text:async()=>JSON.stringify(r.data)}}};
 vm.runInNewContext(code,sandbox);const result={};const res={setHeader(){},status(n){result.status=n;return this},json(x){result.body=x;return this},end(){return this}};await mod.exports({method,body},res);return {result,calls};
}
const token={data:{access_token:'synthetic',expires_in:3600}},saved={data:{data:[{status:'success',details:{id:'synthetic-id'}}]}};
test('success requires a confirmed CRM record; no automatic newsletter subscription',async()=>{const x=await invoke([token,saved]);assert.equal(x.result.status,200);assert.equal(x.result.body.ok,true);assert.equal(x.calls.length,2)});
test('CRM HTTP failure returns failure without redirect',async()=>{const x=await invoke([token,{ok:false,status:500,data:{}}]);assert.equal(x.result.status,502);assert.equal(x.result.body.ok,false);assert.equal(x.result.body.redirect,undefined)});
test('CRM HTTP 200 application error is failure',async()=>{const x=await invoke([token,{data:{data:[{status:'error',code:'INVALID_DATA'}]}}]);assert.equal(x.result.status,502)});
test('token failure cannot report captured',async()=>{const x=await invoke([{data:{error:'invalid_client'}}]);assert.equal(x.result.status,502);assert.equal(x.calls.length,1)});
test('malformed field types rejected before network',async()=>{const x=await invoke([],{name:{},email:[],phone:4});assert.equal(x.result.status,400);assert.equal(x.calls.length,0)});
test('explicit marketing opt-in attempts campaign only after CRM confirmation',async()=>{const x=await invoke([token,saved,{data:{code:'0'}}],{name:'Synthetic',email:'test@example.invalid',phone:'test',marketingConsent:true});assert.equal(x.calls.length,3);assert.equal(x.result.status,200)});
test('campaign failure does not erase a saved enquiry',async()=>{const x=await invoke([token,saved,new Error('synthetic')],{name:'Synthetic',email:'test@example.invalid',phone:'test',marketingConsent:true});assert.equal(x.result.status,200)});
