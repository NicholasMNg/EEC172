const process = require('process');
const google = require('googleapis').GoogleApis;
const googleapis = new google();
const googleAuth = require('google-auth-library');
const nodemailer = require('nodemailer');
const mailjet = require('node-mailjet');
const Gmail = require('node-gmail-api');
const base64js = require('base64-js');
const TextDecoder = require('text-encoding').TextDecoder;
const htmlToText = require('html-to-text');
const https = require('https');
const randomstring = require('randomstring');
const querystring = require('querystring');

const clientID = '932749130251-60a3c58clghu3quij7hi303dc8e2s7e7.apps.googleusercontent.com'; //oauth client ID
const clientSecret = 'KS7sZJWqn0Q-i7VZwTcvz4nA'; //oauth client secret
const MAILJET_PUBLIC = '9aa4313b63c99304d4ff7f4be220fb27'; //public api key for mailjet
const MAILJET_PRIVATE = 'fa53ec248fc524c0c650958a5e987d8a'; //private api key for mailjet

var redirectURL = 'http://localhost:8080/oauth2callback';
if (process.env.NODE_ENV == 'production')
    redirectURL = 'https://eec172-197408.appspot.com/oauth2callback'; //oauth callback url

var auth = new googleAuth();
var oauth2Client = new auth.OAuth2(clientID, clientSecret, redirectURL); //create oauth client object

//Macro for sending http response
function respond (res, status, message)
{
    res.status(status) //status
        .set('Content-Type', 'application/json') //header
        .send(message) //body
        .end(); //end response
}

//Retrieves a new access token from google using a saved refresh token
function GetNewAccessToken (refreshToken, callback)
{
    var postData = querystring.stringify({ //data required to send for access token retrieval
        client_id: clientID,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
    });

    var postOptions = { //http request options
        host: 'accounts.google.com',
        port: 443,
        path: '/o/oauth2/token',
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    }

    var httpsReq = https.request(postOptions, postCB); //sending http request
    httpsReq.on('error', function (err) { //error handling
        console.log('problem with request: ' + err.message);
    });
    httpsReq.write(postData); //sending formatted data to google
    httpsReq.end(); //ends the request

    function postCB (res) //http request callback function
    {
        var data = ''; //stores response

        res.setEncoding('utf8'); //encoding type
        res.on('data', function (body) { //appends to the store variable because the data is chunked
            data += body;
        });
        res.on('end', function () { //called when data transfer is finished
            var retObj = JSON.parse(data); //turns response string into object
            if (retObj.hasOwnProperty('access_token')) //if it contains an access token
            {
                oauth2Client.credentials = { //set the credentials of the oauth client object
                    refresh_token: refreshToken,
                    access_token: retObj.access_token,
                    expiry_date: 3600,
                    token_type: 'Bearer'
                };
                callback(retObj.access_token); //calls the passed in callback function with the access token
            }
        });
    }
}

//Called when authentication is done through the emailed link
function OAuth2CB (knex, req, res)
{
    var refreshToken = ''; //stores refresh token

    var code = req.query.code; //gets one time authorization code from get url
    oauth2Client.getToken(code, function (err, tokens) { //gets tokens from authorization code
        if (err) //google api error
        {
            respond(res, 400, 'Error getting tokens');
            return;
        }

        var accessToken = tokens.access_token; //retrieved access token
        refreshToken = tokens.refresh_token; //stores retrieved refresh token in higher scope

        var httpsOptions = { //http request options
            hostname: 'www.googleapis.com',
            port: 443,
            path: '/oauth2/v1/userinfo?access_token=' + accessToken, //path including accessToken
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        };

        var httpsReq = https.request(httpsOptions, httpsCB); //request to google for user information of person tied to the user token (used for getting user's email address)
        httpsReq.on('error', function(err) { //error handling
            console.log('problem with request: ' + err.message);
        });
        httpsReq.end(); //ends http request
    });

    function httpsCB (cbRes) //callback for user information fetch
    {
        cbRes.setEncoding('utf8');
        cbRes.on('data', function (cbBody) { //when recieving data (should fit in single chunk)
            var retObj = JSON.parse(cbBody); //parses retrieved data into object
            var email = retObj.email;

            //Check if requested new user already exists in the users table
            knex('users') //MySQL query on Cloud database using knex connection
                .select() //SELECT * FROM 'users' where 'email' = email
                .where('email', email)
                .then(function (rows) { //on data get from database
                    if (rows.length > 0) //if any rows exists
                        respond(res, 400, 'User Already Exists');
                    else
                    {
                        console.log('Creating New User');
                        var newCode = randomstring.generate(12); //generated random 12 character alphanumeric string
                                                                 //this will be the code the user uses to login from now on
                        var data = { //new row to add to table
                            email: email, //users email
                            rToken: refreshToken, //users refresh token
                            userCode: newCode //newly generated string
                        };

                        //Inserts new row into users table
                        knex('users')
                            .insert(data)
                            .catch((err) => { console.log(err); }) //error catch
                            .then(function (patRows) {
                                respond(res, 200, 'Successful Insert');
                            });
                        
                        //Email new user with their user code via mailjet
                        var mailData = {
                            'Messages': [{
                                'From': {
                                    'Email': 'eec172emailclient@gmail.com',
                                    'Name': 'No Reply'
                                },
                                'To': [{
                                    'Email': data.email,
                                    'Name': 'New Client'
                                }],
                                'Subject': 'Email Client User Code',
                                'TextPart': 'Your Email Client User Code is "' + newCode + '". Use this to log in on the CC3200.'
                            }]
                        };
                    
                        //make api connection with mailjet
                        var mailer = mailjet.connect(MAILJET_PUBLIC, MAILJET_PRIVATE);
                    
                        //sends email
                        var request = mailer.post('send', { 'version': 'v3.1' }).request(mailData);
                        request
                            .then(function (result) {}) //required for send to process
                            .catch(function (err) {}); //error handling
                    }
                });
        });
    }
}

//Called when an email is entered to be registered
//Will send a link that verifies this application access to users email
function Register (knex, req, res)
{
    var data = req.body;

    //generates the authentication url based off of requested scopes.
    //in this case the scopes include full access to the users email
    var authURL = oauth2Client.generateAuthUrl({
        access_type: 'offline', //offline access request means a refresh token will be given when authorization code is exchanged
        scope: ['https://mail.google.com/', 'https://www.googleapis.com/auth/userinfo.email']
    });

    //Email potential new user with an activation code via mailjet
    var mailData = {
        'Messages': [{
            'From': {
                'Email': 'eec172emailclient@gmail.com',
                'Name': 'No Reply'
            },
            'To': [{
                'Email': data.email,
                'Name': 'New Client'
            }],
            'Subject': 'Email Client Verification',
            'HtmlPart': '<a href="' + authURL + '">Allow CC3200 to Act as Email Client</a>'
        }]   
    };

    //sets up mailjet connection using api keys
    var mailer = mailjet.connect(MAILJET_PUBLIC, MAILJET_PRIVATE);

    //sends email
    var request = mailer.post('send', { 'version': 'v3.1' }).request(mailData);
    request
        .then(function (result) {
            respond(res, 200, 'EMAIL SENT');
        })
        .catch(function (err) {
            respond(res, 400, 'ERROR ON SEND: ' + err);
        });
}

//Validates that user with code exists in users table
function Login (knex, req, res, cb)
{
    var data = req.body;

    var user = { //user object template
        email: '',
        code: '',
        token: ''
    }; 

    if (!data.hasOwnProperty('code')) //check for code property in sent object
    {
        respond(res, 400, 'Bad Request: ' + JSON.stringify(data));
        cb(user);
        return;
    }
    
    //Query the users table for code
    knex('users') //SELECT * FROM 'users' WHERE 'userCode' = data.code
        .select()
        .where('userCode', data.code)
        .then(function (rows) {
            if (rows.length == 0) //If no row exists with said code
            {
                cb(user); //returns the blank template
                respond(res, 400, 'Bad Code');
                return;
            }
            else //If row exists
            {
                //fills user object with information from table
                user.email = rows[0].email;
                user.code = data.code;
                user.token = rows[0].rToken;
                GetNewAccessToken(user.token, setCredentials); //gets new access token to set oauth client object credentials
                cb(user); //returns the user object for setting
                respond(res, 200, 'Successful Login');
                return;
            }
        });
    
    //Sets oauth client object credentials
    function setCredentials (accessToken)
    {
        var cred = { //credential object
            refresh_token: user.token,
            expiry_date: 3600, //whent the access token expires
            access_token: accessToken,
            token_type: 'Bearer'
        };
        oauth2Client.credentials = cred;
    }
}

//Determines whether to get a specific message or message meta data
function Fetch (user, req, res)
{
    var data = req.body;
    if (data.hasOwnProperty('meta')) //check request for meta property
    {
        if (data.meta == 0)
            FetchIDs(user, req, res);
        else if (data.meta == 1)
            FetchMeta(user, req, res);
        else
            FetchMessage(user, req, res);
    }
    else
        respond(res, 400, 'Bad Request');
}

//Gets message ids
function FetchIDs (user, req, res)
{
    var data = req.body;

    GetNewAccessToken(user.token, fetch); //gets a new access token with user refresh token
    function fetch (accessToken) //new access token callback
    {
        var gmail = new Gmail(accessToken); //creates new gmail interface
        var messages = gmail.messages('label:' + data.label, { fields: ['id'] }); //creates request for email ids
        var ret = []; //return array

        messages.on('data', function (d) { //on email get, push the id
            ret.push(d.id);
        });
        messages.on('end', function () { //once all emails are gotten, respond with the array
            respond(res, 200, JSON.stringify(ret));
        });
    }
}

//Gets message meta data
function FetchMeta (user, req, res)
{
    var data = req.body;

    GetNewAccessToken(user.token, fetch); //gets a new access token from user refresh token
    function fetch (accessToken) //new access token callback
    {
        var gmail = googleapis.gmail('v1'); //creates new gmail interface
        gmail.users.messages.get({ //get message by id
            auth: oauth2Client, //authorization
            userId: 'me',
            id: data.id //message id
        }, function (err, response) { //response from get
            if (err) //error handling
            {
                respond(res, 400, 'API Error');
                return;
            }
            var message = ProcessEmail(response); //extracts data from email
            respond(res, 200, JSON.stringify(message));
        });
    }

    function ProcessEmail (email)
    {
        var ret = { //object to hold mail metat data
            labels: email.labelIds,
            from: getHeader(email.payload.headers, 'From'),
            to: getHeader(email.payload.headers, 'To'),
            subject: getHeader(email.payload.headers, 'Subject'),
            date: getHeader(email.payload.headers, 'Date').substring(5, 11),
        }
        return ret;

        function getHeader (headers, headerName) //macro to fetch header from payload
        {
            for (var i = 0; i < headers.length; i++)
                if (headers[i].name == headerName)
                    return headers[i].value;
            return '';
        }
    }
}

//Gets message by id
function FetchMessage (user, req, res)
{
    var data = req.body;

    GetNewAccessToken(user.token, fetch); //gets a new access token from user refresh token
    function fetch (accessToken) //new access token callback
    {
        var gmail = googleapis.gmail('v1'); //creates new gmail interface
        gmail.users.messages.get({ //get message by id
            auth: oauth2Client, //authorization
            userId: 'me',
            id: data.id //message id
        }, function (err, response) { //response from get
            if (err) //error handling
            {
                respond(res, 400, 'API Error');
                return;
            }
            var message = ProcessEmail(response); //extracts data from email
            respond(res, 200, JSON.stringify({'message': message}));
        });
    }

    function ProcessEmail (email)
    {
        //Mark message as read if unread
        var labels = email.labelIds;
        var isRead = true;
        for (var i = 0; i < labels.length; i++) //check for unread label
        {
            if (labels[i] == 'UNREAD')
            {
                isRead = false;
                break;
            }
        }
        if (isRead)
        {
            var request = { //toggle label request object
                body: {
                    label: 'UNREAD',
                    id: data.id
                }
            };
            ToggleMark(user, request, null, false); //toggles label
        }

        return getBody(email.payload) //extract email message

        function getBody(message)
        {
            var encodedBody = ''; //stores message body
            if (typeof message.parts === 'undefined') //if the message is not encoded by parts
                encodedBody = message.body.data; //message body set to data section
            else
                encodedBody = getHTMLPart(message.parts); //message body parsed as html
            encodedBody = encodedBody.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, ''); //part of decoding
            var decoded = Base64Decode(encodedBody); //decode message from base 64
            var htmlOptions = { //settings for parsing html to plain text
                ignoreHref: true,
                ignoreImage: true,
                preserveNewlines: true,
                wordwrap: 80,
                format: {
                    heading: function (elem, fn, options) {
                        var h = fn(elem.children, options);
                        return '====\n' + h.toUpperCase() + '\n====';
                    }
                }
            };
            return htmlToText.fromString(decoded, htmlOptions); //parse html to plain text
        }

        function getHTMLPart(arr) //searches recursively through parts for a part with mime type html
        {
            for(var x = 0; x <= arr.length; x++)
            {
                if(typeof arr[x].parts === 'undefined')
                {
                    if(arr[x].mimeType === 'text/html')
                        return arr[x].body.data;
                }
                else
                    return getHTMLPart(arr[x].parts);
            }
            return '';
        }

        function Base64Decode (str, encoding = 'utf-8') //base 64 decoder
        {
            var bytes = base64js.toByteArray(str); //turns encoded message into byte array
            return new TextDecoder(encoding).decode(bytes); //uses decoder to turn byte array into utf-8
        }
    }
}

//Sends an email from the user's email
function Send (user, req, res)
{
    var data = req.body;
    
    //checks that the request has the requisite properties
    if (!data.hasOwnProperty('recipient') || !data.hasOwnProperty('subject') || !data.hasOwnProperty('message'))
    {
        respond(res, 400, 'Bad Request');
        return;
    }

    GetNewAccessToken(user.token, sendMail); //gets a new access token from users refresh token

    function sendMail (accessToken) //new access token callback
    {
        var transporter = nodemailer.createTransport({ //creates nodemailer transporter
            host: 'smtp.gmail.com', //mail host
            port: 465, //smtp port
            secure: true,
            auth: { //transport authorization
                type: 'OAuth2',
                user: user.email, //users email
                clientId: clientID, //oauth client id
                clientSecret: clientSecret, //oauth client secret
                refreshToken: user.token, //users refresh token
                accessToken: accessToken, //fetched access token
                expires: 1484314697598 //expiration of transporter
            }
        });
    
        var message = { //email passed in through http request
            from: user.email,
            to: data.recipient,
            subject: data.subject,
            text: data.message
        };
    
        transporter.sendMail(message, function (err, info) { //send email through transporter
            respond(res, 200, 'Email sent');
        });
    }
}

////////////////////END ME NOW
function ListLabels (user, req, res)
{
    var gmail = googleapis.gmail('v1');
    gmail.users.labels.list({
        auth: oauth2Client,
        userId: 'me'
    }, function (err, response) {
        if (err)
        {
            console.log('The API returned an error: ' + err);
            respond(res, 400, 'API Error');
            return;
        }
        var labelsArr = [];
        var labels = response.labels;
        if (labels.length == 0)
            console.log('No labels found.');
        else
        {
            //console.log('Labels:');
            for (var i = 0; i < labels.length; i++)
            {
                var label = labels[i];
                //console.log('- %s', label.name);
                labelsArr.push(label.name);
            }
        }
        respond(res, 200, JSON.stringify(labelsArr));
    });
}

//Trashes or Deletes an email based on the messages label
function Delete (user, req, res)
{
    var data = req.body;

    GetNewAccessToken(user.token, del); //gets new access tokwn from users refresh token
    function del (accessToken) //new access token callback
    {
        var gmail = googleapis.gmail('v1'); //creates new gmail interface
        var options = { //gmail interface options
            auth: oauth2Client, //authorization
            userId: 'me',
            id: data.id //message id
        };
        gmail.users.messages.get(options, function (getErr, getReponse) { //get message by id
            if (getErr) //error handling
            {
                respond(res, 400, 'API Error');
                return;
            }
            var inTrash = false;
            for (var i = 0; i < getReponse.labelIds.length; i++) //loops through message labels looking for 'TRASH'
                if (getReponse.labelIds[i] == 'TRASH')
                {
                    inTrash = true;
                    break;
                }
            if (inTrash) //if the message is marked as trash
                gmail.users.messages.delete(options, function (err, response) { //delete email
                    if (err) //error handling
                    {
                        respond(res, 400, 'API Error');
                        return;
                    }
                    respond(res, 200, 'Success (Delete)');
                });
            else //if message is not in trash
                gmail.users.messages.trash(options, function (err, response) { //trash email
                    if (err) //error handling
                    {
                        respond(res, 400, 'API Error');
                        return;
                    }
                    respond(res, 200, 'Success (Trash)');
                });
        });
    }
}

//Restores an email from the trash
function Restore (user, req, res)
{
    var data = req.body;

    GetNewAccessToken(user.token, restore); //gets new access tokwn from users refresh token
    function restore (accessToken) //new access token callback
    {
        var gmail = googleapis.gmail('v1'); //creates new gmail interface
        var options = { //gmail interface options
            auth: oauth2Client, //authorization
            userId: 'me',
            id: data.id //message id
        };
        gmail.users.messages.get(options, function (getErr, getReponse) { //get message by id
            if (getErr) //error handling
            {
                respond(res, 400, 'API Error');
                return;
            }
            var inTrash = false;
            for (var i = 0; i < getReponse.labelIds.length; i++) //loops through message labels looking for 'TRASH'
                if (getReponse.labelIds[i] == 'TRASH')
                {
                    inTrash = true;
                    break;
                }
            if (inTrash) //if the message is marked as trash
                gmail.users.messages.untrash(options, function (err, response) { //restores email
                    if (err) //error handling
                    {
                        respond(res, 400, 'API Error');
                        return;
                    }
                    respond(res, 200, 'Success (Restore)');
                });
            else
                respond(res, 200, 'Message Not in Trash');
        });
    }
}

//Toggles a label on an email (used for starred and important)
function ToggleMark (user, req, res, doRespond)
{
    var data = req.body;
    var label = data.label;

    GetNewAccessToken(user.token, del); //gets new access tokwn from users refresh token
    function del (accessToken) //new access token callback
    {
        var gmail = googleapis.gmail('v1'); //creates new gmail interface
        var options = { //gmail interface options
            auth: oauth2Client, //authorization
            userId: 'me',
            id: data.id //message id
        };
        gmail.users.messages.get(options, function (getErr, getReponse) { //get message by id
            if (getErr) //error handling
            {
                if (doRespond)
                    respond(res, 400, 'API Error');
                return;
            }
            var hasLabel = false; //does the message have the label
            for (var i = 0; i < getReponse.labelIds.length; i++) //look for label
                if (getReponse.labelIds[i] == label)
                {
                    hasLabel = true;
                    break;
                }
            var add = []; //add labels
            var remove = []; //remove labels
            if (hasLabel) //if it has the label then add the label to the remove list
                remove.push(label);
            else //if it doesn't have the label then add the label to the add list
                add.push(label);
            var postObj = { //object to post to modify path
                addLabelIds: add,
                removeLabelIds: remove
            };

            var httpsOptions = { //http request options
                hostname: 'www.googleapis.com',
                port: 443,
                path: '/gmail/v1/users/me/messages/' + data.id + '/modify', //path to modify message label google api
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + accessToken //use access token to authorize http request
                }
            };
            var httpsReq = https.request(httpsOptions, httpsCB); //http request
            httpsReq.on('error', function(err) {
                console.log('problem with request: ' + err.message);
            });
            httpsReq.write(JSON.stringify(postObj)); //post label info
            httpsReq.end(); //end http request

            function httpsCB (httpsRes)
            {
                httpsRes.setEncoding('utf-8');
                httpsRes.on('data', function (body) { //on recieving data from google api
                    var bodyObj = JSON.parse(body);
                    if (body.hasOwnProperty('error')) //error handling
                    {
                        if (doRespond)
                            respond(res, 400, 'Marking Error');
                    }
                    else //successful
                    {
                        if (doRespond)
                            respond(res, 200, 'Success (Marking)');
                    }
                });
            }
        });
    }
}

//Exports
module.exports.OAuth2CB = OAuth2CB;
module.exports.Register = Register;
module.exports.Login = Login;
module.exports.Fetch = Fetch;
module.exports.Send = Send;
module.exports.ListLabels = ListLabels;
module.exports.Delete = Delete;
module.exports.Restore = Restore;
module.exports.ToggleMark = ToggleMark;