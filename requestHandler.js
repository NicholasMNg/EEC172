const process = require('process');
const googleapis = require('googleapis');
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

const clientID = '932749130251-60a3c58clghu3quij7hi303dc8e2s7e7.apps.googleusercontent.com';
const clientSecret = 'KS7sZJWqn0Q-i7VZwTcvz4nA';
const MAILJET_PUBLIC = '9aa4313b63c99304d4ff7f4be220fb27';
const MAILJET_PRIVATE = 'fa53ec248fc524c0c650958a5e987d8a';

var redirectURL = 'http://localhost:8080/oauth2callback';
if (process.env.NODE_ENV == 'production')
    redirectURL = 'https://eec172-197408.appspot.com/oauth2callback';

var auth = new googleAuth();
var oauth2Client = new auth.OAuth2(clientID, clientSecret, redirectURL);

function respond (res, status, message)
{
    res.status(status)
        .set('Content-Type', 'text/plain')
        .send(message)
        .end();
}

function GetNewAccessToken (refreshToken, callback)
{
    var postData = querystring.stringify({
        client_id: clientID,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
    });

    var postOptions = {
        host: 'accounts.google.com',
        port: 443,
        path: '/o/oauth2/token',
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    }

    var httpsReq = https.request(postOptions, postCB);
    httpsReq.on('error', function (err) {
        console.log('problem with request: ' + err.message);
    });
    httpsReq.write(postData);
    httpsReq.end();

    function postCB (res)
    {
        var data = '';

        res.setEncoding('utf8');
        res.on('data', function (body) {
            data += body;
        });
        res.on('end', function () {
            var retObj = JSON.parse(data);
            if (retObj.hasOwnProperty('access_token'))
                callback(retObj.access_token);
        });
    }
}

function OAuth2CB (knex, req, res)
{
    var accessToken = '';
    var refreshToken = '';

    var code = req.query.code;
    oauth2Client.getToken(code, function (err, tokens) {
        if (err)
        {
            console.log(err);
            respond(res, 400, 'Error getting tokens');
            return;
        }

        console.log(tokens);
        accessToken = tokens.access_token;
        refreshToken = tokens.refresh_token;
        //ListEmails(accessToken, 5);

        var httpsOptions = {
            hostname: 'www.googleapis.com',
            port: 443,
            path: '/oauth2/v1/userinfo?access_token=' + accessToken,
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        };

        var httpsReq = https.request(httpsOptions, httpsCB);
        httpsReq.on('error', function(err) {
            console.log('problem with request: ' + err.message);
        });
        httpsReq.end();
    });

    function httpsCB (cbRes)
    {
        cbRes.setEncoding('utf8');
        cbRes.on('data', function (cbBody) {
            var retObj = JSON.parse(cbBody);
            var email = retObj.email;
            knex('users')
                .select()
                .where('email', email)
                .then(function (rows) {
                    if (rows.length > 0)
                        respond(res, 400, 'User Already Exists');
                    else
                    {
                        console.log('Creating New User');
                        var newCode = randomstring.generate(12);
                        var data = {
                            email: email,
                            rToken: refreshToken,
                            userCode: newCode
                        };
                        knex('users')
                            .insert(data)
                            .catch((err) => { console.log(err); })
                            .then(function (patRows) {
                                respond(res, 200, 'Successful Insert');
                            });
                        
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
                    
                        var mailer = mailjet.connect(MAILJET_PUBLIC, MAILJET_PRIVATE);
                    
                        var request = mailer.post('send', { 'version': 'v3.1' }).request(mailData);
                        request
                            .then(function (result) {})
                            .catch(function (err) {});
                    }
                });
        });
    }
}

function Register (knex, req, res)
{
    var data = req.body;

    var authURL = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://mail.google.com/', 'https://www.googleapis.com/auth/userinfo.email']
    });

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

    var mailer = mailjet.connect(MAILJET_PUBLIC, MAILJET_PRIVATE);

    var request = mailer.post('send', { 'version': 'v3.1' }).request(mailData);
    request
        .then(function (result) {
            //console.log(result.body);
            resond(res, 200, 'EMAIL SENT');
        })
        .catch(function (err) {
            //console.log(err);
            respond(res, 400, 'ERROR ON SEND');
        });
}

function Login (knex, req, res, cb)
{
    var data = req.body;

    var user = {
        email: '',
        code: '',
        token: ''
    }; 

    if (!data.hasOwnProperty('code'))
    {
        respond(res, 400, 'Bad Request');
        cb(user);
        return;
    }
    
    knex('users')
        .select()
        .where('userCode', data.code)
        .then(function (rows) {
            if (rows.length == 0)
            {
                cb(user);
                respond(res, 400, 'Bad Code');
                return;
            }
            else
            {
                user.email = rows[0].email;
                user.code = data.code;
                user.token = rows[0].rToken;
                cb(user);
                respond(res, 200, 'Successful Login');
                return;
            }
        });
}

function Navigate (user, req, res, callback)
{

}

function FetchIDs (user, req, res)
{
    var data = req.body;
    //console.log(data);

    GetNewAccessToken(user.token, fetch);
    function fetch (accessToken)
    {
        var gmail = new Gmail(accessToken);
        var messages = gmail.messages('label:' + data.label, { max: data.amt });
        var ret = '';

        messages.on('data', function (d) {
            console.log(d);
            //ret += ProcessEmail(d);
        });
        messages.on('end', function () {
            console.log('END');
        });
    }
}

function FetchMessage (user, req, res)
{
    var data = req.body;
    console.log(data);

    GetNewAccessToken(user.token, fetch);
    function fetch (accessToken)
    {
        var gmail = new Gmail(accessToken);
        var messages = gmail.messages('label:' + data.label, { max: data.amt });
        var ret = '';

        messages.on('data', function (d) {
            console.log(d);
            //ret += ProcessEmail(d);
        });
        messages.on('end', function () {
            console.log('END');
        });
    }

    function ProcessEmail (email)
    {
        console.log(email);
        var payload = email.payload;
        var to = getHeader(payload.headers, 'To');
        var subject = getHeader(payload.headers, 'Subject');
        var date = getHeader(payload.headers, 'Date');
        var body = getBody(payload);

        console.log('---------------');
        console.log(to);
        console.log(subject);
        console.log(date);
        console.log(body);

        return

        function getHeader (headers, headerName)
        {
            for (var i = 0; i < headers.length; i++)
                if (headers[i].name == headerName)
                    return headers[i].value;
            return '';
        }

        function getBody(message) 
        {
            var encodedBody = '';
            if (typeof message.parts === 'undefined')
                encodedBody = message.body.data;
            else
                encodedBody = getHTMLPart(message.parts);
            encodedBody = encodedBody.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
            var decoded = Base64Decode(encodedBody);
            var htmlOptions = {
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
            return htmlToText.fromString(decoded, htmlOptions);
        }

        function getHTMLPart(arr) 
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

        function Base64Decode (str, encoding = 'utf-8')
        {
            var bytes = base64js.toByteArray(str);
            return new TextDecoder(encoding).decode(bytes);
        }
    }
}

function Send (user, req, res)
{
    var data = req.body;
    console.log(data);
    if (!data.hasOwnProperty('recipient') || !data.hasOwnProperty('subject') || !data.hasOwnProperty('message'))
    {
        respond(res, 400, 'Bad Request');
        return;
    }

    GetNewAccessToken(user.token, sendMail);

    function sendMail (accessToken)
    {
        console.log('Access Token Retrieved');

        var transporter = nodemailer.createTransport({
            host: 'smtp.gmail.com',
            port: 465,
            secure: true,
            auth: {
                type: 'OAuth2',
                user: user.email,
                clientId: clientID,
                clientSecret: clientSecret,
                refreshToken: user.token,
                accessToken: accessToken,
                expires: 1484314697598
            }
        });
    
        var message = {
            from: user.email,
            to: data.recipient,
            subject: data.subject,
            text: data.message
        };
    
        transporter.sendMail(message, function (err, info) {
            console.log(err);
            console.log(info);
            respond(res, 200, 'Email sent');
        });
    }
}

module.exports.OAuth2CB = OAuth2CB;

module.exports.Register = Register;
module.exports.Login = Login;
module.exports.Navigate = Navigate;
module.exports.Fetch = Fetch;
module.exports.Send = Send;