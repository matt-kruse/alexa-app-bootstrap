let alexa = require('alexa-app');

// EXTEND REQUEST
// ====================================
alexa.request.prototype = {
  getState:function() {
    if (this.hasSession()) {
      return this.getSession().get("state");
    }
    return null;
  }
  ,setState:function(state) {
    if (this.hasSession()) {
      this.getSession().set("last_state",this.getSession().get("state"));
      this.getSession().set("state",state);
      //app.log("setState: "+state);
    }
    return this;
  }
  ,pushState:function(state) {
    if (this.hasSession()) {
      let cstate = this.getState() || "";
      this.getSession().set("last_state",cstate);
      if (cstate) { cstate+='~'; }
      this.getSession().set("state", cstate+state);
      //app.log("pushState: "+cstate+state);
    }
    return this;
  }
  ,popState:function(state) {
    if (this.hasSession()) {
      let cstate = this.getState() || "";
      if (state) {
        // Pop up to given state if it exists
        let states = cstate.split('~');
        while (states && states.length && states[states.length-1]!==state) {
          states.pop();
        }
        if (states.length===0) {
          throw "Couldn't find parent state in popState("+state+")";
        }
        this.getSession().set("state", states.join('~'));
      }
      else {
        cstate = cstate.replace(/~[^~]+$/, '');
        this.getSession().set("state", cstate);
      }
    }
    return this;
  }
  ,clearState:function() {
    if (this.hasSession()) {
      this.getSession().set("last_state",this.getSession().get("state"));
      this.getSession().set("state", null);
      //app.log("state: null");
    }
    return this;
  }
  ,restorePreviousState:function() {
    if (this.hasSession()) {
      let prev = this.getSession().get("last_state");
      if (prev) {
        this.getSession().set("state", prev);
      }
    }
    return this;
  }
  // Redirect to a specific intent
  ,setIntent: function(intent) {
    this.data.request.type = "IntentRequest";
    this.data.request.intent = {};
    this.data.request.intent.name = intent;
    this.setState(intent);
  }
  // Populate a slot value manually
  ,setSlot: function(slot,val) {
    this.slots[slot] = {"value":val};
  }
  // Interact with the user's experience
  ,experience:function(exp,bump) {
    if (typeof bump!=="boolean") { bump=true; }
    let u = user;
    if (!u) { return; }
    if (!u.experience) {
      u.experience={};
    }
    let x = u.experience[exp];
    if (bump) {
      if (typeof x==="boolean" || typeof x==="undefined") {
        u.experience[exp] = false;
      }
      else if (typeof x==="number") {
        u.experience[exp]++;
      }
    }
    return x;
  }
};

// EXTEND RESPONSE
// ====================================
alexa.response.prototype = {
  "polly": function(voice) {
    try {
      let ssml = this.response.response.outputSpeech.ssml;
      this.clear();
      this.say(`<voice name="${voice}">${ssml}</voice>`);
    } catch(e) { }
  }
  ,"sayRandom": function(values) {
    this.say(values[Math.floor(Math.random() * values.length)]);
  }
  ,"randomizeSynonyms": function(synonyms) {
    try {
      let ssml = this.response.response.outputSpeech.ssml;
      ssml = ssml.replace(/\{([^\}]+)\}/g, function (m, m1) {
        if (synonyms && synonyms[m1]) {
          let s = synonyms[m1];
          if (s.length) {
            // simple array of synonyms
            return s[Math.floor(Math.random() * s.length)];
          }
        }
        return m1;
      });
      this.response.response.outputSpeech.ssml = ssml;
    } catch(e) { }
  }
};

// CREATE APP
// ====================================
let app = new alexa.app();

// DEFAULTS
// ====================================
app.metadata = {};
app.config = {
  logging_enabled: true
  ,log_request_response: true
};
app.outputSynonyms = {};

// DynamoDB Access
// ===============
app.ddb = function(region) {
  if (!app._ddb) {
    let wrapper = require('ddb-wrapper');
    app._ddb = new wrapper(region || 'us-east-1');
  }
  return app._ddb;
};

// LOGGING
// =======
app.log = function() {
  if (typeof app.config.logging_enabled==="boolean" && app.config.logging_enabled) {
    console.log.apply(console,arguments);
  }
};

// CONVENIENCE METHODS
// ====================================
app.simpleintent = function(intent, utterances, say) {
  utterances = utterances || [];
  if (typeof utterances==="string") { utterances = [utterances]; }
  app.intent(intent,{"utterances":utterances},
    async function(request,response) {
      let user = user;
      let template = eval('`'+say+'`');
      response.say(template);
    }
  );
};
// Remap the askcli() output to ignore intentMaps
app.schemas.askcli = function(invocationName) {
  let model = JSON.parse(app.schemas.skillBuilder());
  model.invocationName = invocationName || app.metadata.invocationName || app.invocationName || app.name;
  let schema = {
    interactionModel: {
      languageModel: model
    }
  };
  schema.interactionModel.languageModel.intents = schema.interactionModel.languageModel.intents.filter( (intent)=> {
    return (/^AMAZON\./.test(intent.name) || (intent.samples && intent.samples.length>0));
  });
  return JSON.stringify(schema, null, 3);
};

// ALEXA API CALLS
// ====================================
app.api = async function(request,endpoint) {
  return new Promise(function(resolve,reject) {
    // Retrieve the product info
    let api = request.data.context.System.apiEndpoint.replace('https://','');
    let token = "bearer " + request.data.context.System.apiAccessToken;
    let locale = request.data.request.locale;
    const https = require('https');
    const options = {
      host: api,
      path: endpoint,
      method: 'GET',
      headers: {
        "Content-Type": 'application/json',
        "Accept-Language": locale,
        "Authorization": token
      }
    };
    let json="";
    //app.log("Calling "+endpoint);
    // Call the API
    const req = https.get(options, (res) => {
      res.setEncoding("utf8");
      //app.log("status",res.statusCode);
      if (res.statusCode === 403) { reject("Permission Denied"); }
      res.on('data', (chunk) => { json += chunk; });
      res.on('end', () => { app.log("json",json); resolve(JSON.parse(json)); });
    });
    req.on('error', (e) => {
      //app.log('Error calling API: ' + e.message);
      reject(e);
    });
  });
};
// Get the list of ISP's
app.list_isp = async ()=> {
  try {
    let inSkillProductInfo = await app.api("/v1/users/~current/skills/~current/inSkillProducts");
    let products = {};
    if (Array.isArray(inSkillProductInfo.inSkillProducts)) {
      let isps = inSkillProductInfo.inSkillProducts;
      for (let i=0; i<isps.length; i++) {
        let isp = isps[i];
        products[isp.referenceName] = isp;
      }
    }
    user.InSkillProducts = products;
    app.log("ending list_isp");
    return products;
  }
  catch(e) {
    say `There was an error loading available products. Please try again.`;
  }
};

// ==========================================================================
// PRE
// ==========================================================================
app.pre = async function (req, res) {
  setContext(req, res);

  // Log all requests
  if (typeof app.config.log_request_response === "boolean" && app.config.log_request_response) {
    app.log(JSON.stringify(request.data));
  }

  // By default, leave session open for button input
  response.shouldEndSession(null);

  // If session already exists, use it.
  // Otherwise, load it
  if (request.hasSession() && request.getSession().get("user") != null) {
    user = request.getSession().get("user");
  }
  if (user===null) {
    let user_id = request.data.session.userId;
    if (app.config.user_persistence_table) {
      try {
        let user_id = request.data.session.userId;
        user = await app.ddb().get(app.config.user_persistence_table, app.config.user_persistence_key || "userid", user_id);
      }
      catch (e) {
        app.log(e);
      }
    }
    if (user === null) {
      // A new user
      if (typeof app.new_user_template==="function") {
		    user = app.new_user_template(user_id);
	    }
      if (!user) { user = {}; }
      if (!user.experience) { user.experience={}; }
      user.request_number = 1;
    }
  }

  // Use STATE to define the intent handler
  if (request.type()==="LaunchRequest" && typeof app.intents["launch"] !== "undefined" && typeof app.intents["launch"].handler === "function") {
    request.setIntent("launch");
  }
  if (request.type()==="IntentRequest") {
    let state = request.getState();
    app.log("Current state: "+state);
    if (state) {
      let potential_intent = state+'~'+request.data.request.intent.name;
      app.log("Potential state: "+potential_intent);
      if (typeof app.intents[potential_intent] !== "undefined" && typeof app.intents[potential_intent].handler === "function") {
        app.log("Switching to nested intent");
        request.pushState(request.data.request.intent.name);
        request.data.request.intent.name = potential_intent;
      }
      else {
        request.setState(request.data.request.intent.name);
        app.log("No matching nested state, switching to intent "+request.data.request.intent.name)
      }
    }
    else {
      request.setState(request.data.request.intent.name);
    }
  }
  // If returning from an ISP, set the state and push on the purchase result
  if (request.type()==="Connections.Response") {
    app.log("Connections.Response");
    let intent = request.data.request.token+"~"+request.data.request.payload.purchaseResult;
    app.log(intent);
    request.setIntent(intent);
  }

  // Store the intent in the user record for debugging
  user.intent = request.getState();

  app.log( request.getState() );
};

// ==========================================================================
// POST
// ==========================================================================
app.post = async function () {
  // Post-process for pluralization, etc
  try {
    let ssml = response.response.response.outputSpeech.ssml;
    if (ssml) {
      response.response.response.outputSpeech.ssml = postprocess(ssml);
    }
  } catch(e) { }

  // Randomize synonyms in the output
  response.randomizeSynonyms(app.outputSynonyms);

  // Store the user back into the session
  if (user) {
    request.getSession().set("user", user);
  }
  else {
    request.getSession().set("user", null);
  }

  // Re-construct the session
  response.prepare();

  // Log all responses
  if (typeof app.config.log_request_response === "boolean" && app.config.log_request_response) {
    app.log(JSON.stringify(request.response,null,3));
  }
};

// Store the request and response on each each request, for easy access
let request = null;
let response = null;
let user = null;
function setContext(req,res) {
  request = req;
  response = res;
  user = null;
}
function _say_concat(strings,values) {
  let str = "";
  for (let i=0; i<Math.max(strings.length,values.length); i++) {
    if (i<strings.length) { str+=strings[i]; }
    if (i<values.length) { str+=values[i]; }
  }
  return str;
}
app.say = function(strings,...values) {
  response.say(_say_concat(strings,values));
  return response;
};
app.ask = function(strings,...values) {
  response.say(_say_concat(strings,values));
  response.shouldEndSession(false);
  return response;
};
app.sayif = function(strings,...values) {
  if (!values.length) { return; }
  let v= values[0];
  if (v==="" || v==="null" || v==="false" || v==="0" || v==="undefined") { return; }
  response.say(_say_concat(strings,values));
  return response;
};
app.saylookup = function(val, o) {
  let keys = Object.keys(o||{}).sort();
  keys.forEach((k,i)=> {
    if (i===keys.length-1 || val<=k) {
      return (typeof o[i]==="function") ? o[i]() : response.say(o[i]);
    }
  });
};
const postprocess = function(str) {
  // Conditional text {?iftrue:then output this repacing $_ with condition?}
  str = str.replace( /\{\?([^:]+):([^?]+)\?\}/g, (m,m1,m2)=> {
    return (m1==="false"||m1===""||m1==="0"||m==="null"||m==="undefined"||+m1===0) ? "" : m2.replace(/\$_/g,m1);
  });
  // word{s} that should be pluralized
  str = str.replace( /(\b)(\d+)(\b.*?)\{s\}/g, (m,m1,m2,m3)=> {
    let str = m1+m2+m3;
    if (+m2===1) { return str; }
    return str+"s";
  });
  // there {are} 5 dogs
  str = str.replace( /\{are\}(.*?\b)(\d+)/g, (m,m1,m2)=> {
    let str = m1+m2;
    if (+m2===1) { return "is"+str; }
    return "are"+str;
  });
  // there are 5 {puppy,puppies}
  str = str.replace( /(\b)(\d+)(\s+)\{(.*?),(.*?)\}/g, (m,m1,m2,m3,m4,m5)=> {
    let str = m1+m2+m3;
    if (+m2===1) { return str+m4; }
    return str+m5;
  });
  // Easy lists {list 4 dogs|2 cats|0 birds}
  str = str.replace( /\{list\s+([^}]+)\}/g, (m,m1)=> {
    let list = m1.split(/\s*\|\s*/), keep=[];
    list.forEach((i)=>{
      if (parseInt(i,10)>0) { keep.push(i); }
    });
    if (keep.length===0) { return ""; }
    if (keep.length===1) { return keep[0]; }
    if (keep.length===2) { return keep[0]+" and "+keep[1]; }
    keep.push(" and "+keep.pop());
    return keep.join(", ");
  });
  // Output {value | alternative if first value is falsey}
  str = str.replace( /\{([^|}]+)\|([^}]+)\}/g, (m,m1,m2)=> {
    return (m1==="false"||m1===""||m1==="0"||m==="null"||m==="undefined"||+m1===0) ? m2 : m1;
  });
  // Remove multiple spaces
  str = str.replace(/\s+/g,' ');
  return str;
};

// Util: Intent Mapper
// ===================
app.createTextResponseFunction = function(str) {
  return (req,res)=>{
    str = str.replace(/<POPSTATE>/g, function() {
      req.popState();
      return "";
    });
    str = str.replace(/<SETSTATE\s+([^>]+)>/g, function(m,m1) {
      req.setState(m1);
      return "";
    });
    str = str.replace(/<CLEARSTATE>/g, function() {
      req.clearState();
      return "";
    });
    res.say(str);
    req.popState();
  };
};
app.intentMap = function(json,state) {
  // Handle a map of multiple intents/states
  if (typeof state!=="string") { state=""; }

  if (typeof json==="string") {
    app.log("Found a handler for " + state);
    app.intents[state] = new alexa.intent(state, {}, app.createTextResponseFunction( json ));
  }
  else if (typeof json==="function") {
    app.log("Found a handler for " + state);
    app.intents[state] = new alexa.intent(state, {}, json);
  }
  else if (typeof json==="object") {
    for (let key in json) {
      if ("default" === key) {
        app.log("Found a handler for " + state);
        let schema = json['schema'] || {};
        app.intents[state] = new alexa.intent(state, schema, typeof json[key]==="function" ? json[key] : app.createTextResponseFunction( json[key]+"" ) );
      }
      else if ("schema" === key) {
        // Ignore
      }
      else {
        let keys = key.split(',');
        keys.forEach((k)=>{
          app.intentMap(json[key], state ? state + '~' + k : k);
        });
      }
    }
  }
};

// Explicitly go to an intent
app.gotoIntent = async function(intent,request,response,setState) {
  if (typeof app.intents[intent] !== "undefined" && typeof app.intents[intent].handler === "function") {
    if (typeof setState==="undefined" || setState) {
      request.setState(intent);
    }
    return Promise.resolve(app.intents[intent].handler(request, response));
  }
  throw "NO_INTENT_FOUND";
};

// Add context map on to an existing intent definition format
app._intent = app.intent;
app.intent = function(name,schema,func,context) {
  if (arguments.length<4) { return app._intent(name,schema,func); }
  if (typeof context!=="object") {
    context={};
  }
  context[DEFAULT] = func;
  context[SCHEMA] = schema;
  app.intentMap( {[name]: context} );
};

let YES = "AMAZON.YesIntent";
let NO = "AMAZON.NoIntent";
let HELP = "AMAZON.HelpIntent";
let FALLBACK = "AMAZON.FallbackIntent";
let DEFAULT = "default";
let SCHEMA = "schema";
let ACCEPTED = "ACCEPTED";
let DECLINED = "DECLINED";
let POPSTATE = function() { return '<POPSTATE>'; };
let NOSTATECHANGE = function() { return '<POPSTATE>'; };
let SETSTATE = function(state) { return `<SETSTATE ${state}>`; };
let CLEARSTATE = function() { return `<CLEARSTATE>`; };
let GOTO = function(intent) {
  return async function(request,response) { return app.gotoIntent(intent,request,response); }
};

// REQUIRED INTENTS
// ================
// These can be over-ridden in the skill's code
app.requiredIntentHandler = function(){};
app.intent("AMAZON.HelpIntent", {"slots": {},"utterances": []},
  app.requiredIntentHandler
);
app.intent("AMAZON.StopIntent", app.requiredIntentHandler);
app.intent("AMAZON.CancelIntent", app.requiredIntentHandler);
// For RENDER_TEMPLATE
app.intent("AMAZON.PreviousIntent", app.requiredIntentHandler);
app.intent("AMAZON.NextIntent", app.requiredIntentHandler);
app.intent("AMAZON.MoreIntent", app.requiredIntentHandler);
app.intent("AMAZON.ScrollLeftIntent", app.requiredIntentHandler);
app.intent("AMAZON.ScrollRightIntent", app.requiredIntentHandler);
app.intent("AMAZON.ScrollUpIntent", app.requiredIntentHandler);
app.intent("AMAZON.ScrollDownIntent", app.requiredIntentHandler);
app.intent("AMAZON.PageDownIntent", app.requiredIntentHandler);
app.intent("AMAZON.PageUpIntent", app.requiredIntentHandler);
app.intent("AMAZON.NavigateSettingsIntent", app.requiredIntentHandler);
app.intent("AMAZON.NavigateHomeIntent", app.requiredIntentHandler);

// EVENT HANDLING
// ==============
app.on('AlexaSkillEvent.SkillPermissionAccepted', async()=>{
  try {
    let user_id = request.data.context.System.user.userId;
    app.log("Permission Accepted!", request.data.context.System.user.userId);
//    user = await app.ddb().get(app.config.user_persistence_table, app.config.user_persistence_key, user_id);
//    app.log(user);
    let name = await app.api("/v2/accounts/~current/settings/Profile.name");
//    app.log(name);
//    user.name = name;
//    user.linked = true;
//    await persist_user();
  } catch(e) {
    app.log("Error calling API");
    app.log(e.message);
    app.log(e);
  }
});
app.on('AlexaSkillEvent.SkillPermissionChanged', async()=>{
  try {
    let user_id = request.data.context.System.user.userId;
    app.log("Permission Changed!", request.data.context.System.user.userId);
//    user = await app.ddb().get(app.config.user_persistence_table, app.config.user_persistence_key, user_id);
//    user.name = null;
//    user.linked = false;
//    await persist_user();
  } catch(e) {
    app.log(e);
  }
});

// ERROR HANDLING
// ==============
app.error = function(exception, request, response) {
  app.log(exception);
  app.log(exception.stack);
  let line = "";
  try {
    let m = exception.stack.match(/:(\d+):\d+/);
    if (m && m[1]) {
      line = "at line number " + m[1];
    }
    user.exception = exception.toString();
  } catch(e) { }
  response.say(`Exception ${line}. ${exception.toString()}.`);
};

// Util
app.has_display = function(request) {
  try {
    return !!request.data.context.System.device.supportedInterfaces.Display;
  }
  catch(e) { return false; }
};

// LAMBDA HANDLER
// ==============
// connect to lambda
app.lambda_handler = function(event, context, callback) {
  if (event && "aws.events"===event.source) {
    // Scheduled Event!
    if (typeof app.scheduler==="function") {
      app.scheduler(event).then(() => {
        callback(null, {"status":"success"});
      }).catch((e) => {
        callback(e);
      });
    }
  }
  else {
    // Alexa Request
    app.handler(event, context, callback);
  }
};


// EXPORT
// ====================================
module.exports = {
  'app': app
  ,'say': app.say
  ,'ask': app.ask
  ,'sayif': app.sayif
  ,'saylookup': app.saylookup
  ,'log': app.log
  ,'lambda_handler': app.lambda_handler

  ,'YES':YES
  ,'NO':NO
  ,'HELP':HELP
  ,'FALLBACK':FALLBACK
  ,'DEFAULT':DEFAULT
  ,'SCHEMA':SCHEMA
  ,'ACCEPTED':ACCEPTED
  ,'DECLINED':DECLINED
  ,'POPSTATE':POPSTATE
  ,'NOSTATECHANGE':NOSTATECHANGE
  ,'SETSTATE':SETSTATE
  ,'CLEARSTATE':CLEARSTATE
  ,'GOTO':GOTO
};
