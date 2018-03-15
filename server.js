const process = require('process');
const express = require('express');
const Knex = require('knex');
const requestHandler = require('./requestHandler.js');

const app = express();

const bodyParser = require('body-parser');
const jsonParser = bodyParser.json();
app.use(jsonParser);

app.enable('trust proxy');

const knex = Connect()

function Connect () //establish connection with database
{	
    var config = { //make sure your environment variables are set. This is for creating the proxy connection
        user: process.env.SQL_USER,
        password: process.env.SQL_PASSWORD,
        database: process.env.SQL_DATABASE,
    };
    
    if (process.env.NODE_ENV == 'production')
        config.socketPath = '/cloudsql/eec172-197408:us-west1:email-client';
    
    if (process.env.NODE_ENV != 'production') { // This is for when the program is not deployed onto Google App Engine
        config.host = '35.227.155.1'; 
        config.user = 'eec172';
        config.password = 'eec172';
        config.database = 'email-users';
    }

    var knex = Knex({ //initialize Knex connection with config properties
        client: 'mysql',
        connection: config
    }); 
	
    return knex;
}

var user = { //user currently using cc3200
    email: '',
    code: '', //used for validating posts
    token: '' //token to validate google api calls
}; 

var datastore = { //used for passing data onto the CC3200
    flag: 0, //action to be performed: 0-nothing, 1-logout, 2-navigate, 3-compose, 4-writeSubject
             //5-writeMessage, 6-send(echo), 7-delete, 8-restore, 9-label, 10-home
    data: '' //data to send CC3200
}

//macro for sending http response
function respond (res, status, message)
{
    res.status(status) //status
        .set('Content-Type', 'application/json') //header
        .send(message) //body
        .end(); //response end
}

//Routing Handlers

////////////////////END ME NOW
app.get('/testEcho', function (req, res, next) {
    var obj = {
        user: user,
        datastore: datastore
    };
    respond(res, 200, JSON.stringify(obj));
});

//Used on authorization log in to insert a new user into the database
app.get('/oauth2callback', function (req, res, next) {
    requestHandler.OAuth2CB(knex, req, res);
});

//Sets the flag for a logout request
app.post('/markLogout', function (req, res, next) {
    datastore.flag = 1;
    datastore.data = '';
    respond(res, 200, 'Pending Log Out');
});

//Sets the current user and datastore to blank values
app.post('/logout', function (req, res, next) {
    if (!req.is('application/json')) //checking header
        return next();
    if (!req.body.hasOwnProperty('code')) //check for code property
        respond(res, 400, 'Bad Request');
    else if (req.body.code != user.code) //checking to make sure it is the current user
        respond(res, 400, 'Bad Credentials');
    else
    {
        user = { //blank user
            email: '',
            code: '',
            token: ''
        }; //blank datastore
        datastore = {
            flag: 0,
            data: ''
        };
        respond(res, 200, 'Successful Logout');
    }
});

//Used to fetch the datastore variable
//Voids on fetch
app.post('/timer', function (req, res, next) {
    if (!req.is('application/json'))
        return next();
    if (!req.body.hasOwnProperty('code')) //check for code property
        respond(res, 400, 'Bad Request');
    else if (req.body.code != user.code) //checking to make sure it is the current user
        respond(res, 400, 'Bad Credentials');
    else
    {
        respond(res, 200, JSON.stringify(datastore)); //reponds with current datastore object

        datastore = { //blank datastore
            flag: 0,
            data: ''
        };
    }
});

//Sends authentication link to requested new user
app.post('/register', function (req, res, next) {
    if (!req.is('application/json'))
        return next();
    requestHandler.Register(knex, req, res);
});

//Sets the servers current active user
app.post('/login', function (req, res, next) {
    if (!req.is('application/json'))
        return next();
    
    if (user.email != '') //checks if a user is already logged in
        respond(res, 400, 'User is already logged in');
    else
        requestHandler.Login(knex, req, res, LoginCallback);
    
    function LoginCallback (newUser) { user = newUser; } //Sets the new user value
});

//Sets the flag for a navigate request
app.post('/navigate', function (req, res, next) {
    if (!req.is('application/json'))
        return next();
    datastore.flag = 2; //flag set
    datastore.data = req.body.box; //requested box to move to (i.e. inbox, spam, trash, etc.)
    respond(res, 200, 'Success');
});

//Fetches Email/s
app.post('/fetch', function (req, res, next) {
    if (!req.is('application/json'))
        return next();
    if (!req.body.hasOwnProperty('code')) //check for code property
        respond(res, 400, 'Bad Request');
    else if (req.body.code != user.code) //checking to make sure it is the current user
        respond(res, 400, 'Bad Credentials');
    else
        requestHandler.Fetch(user, req, res);
});

//Sets the flag for a compose request
app.post('/compose', function (req, res, next) {
    datastore.flag = 3;
    datastore.data = '';
    respond(res, 200, 'Success');
});

//Sets flag to write text to the subject field when in compose state
app.post('/writeSubject', function (req, res, next) {
    if (!req.is('application/json'))
        return next();
    datastore.flag = 4;
    datastore.data = req.body.subject;
    respond(res, 200, 'Success');
});

//Sets flag to write text to the message field when in compose state
app.post('/writeMessage', function (req, res, next) {
    if (!req.is('application/json'))
        return next();
    datastore.flag = 5;
    datastore.data = req.body.message;
    respond(res, 200, 'Success');
});

//Sets the flag for a send request
app.post('/markSend', function (req, res, next) {
    if (!req.is('application/json'))
        return next();
    datastore.flag = 6;
    datastore.data = '';
    respond(res, 200, 'Success');
});

////////////////////END ME NOW
app.post('/listLabels', function (req, res, next) {
    if (!req.is('application/json'))
        return next();
    if (!req.body.hasOwnProperty('code'))
        respond(res, 400, 'Bad Request');
    else if (req.body.code != user.code)
        respond(res, 400, 'Bad Credentials');
    else
        requestHandler.ListLabels(user, req, res, true);
});

//Sends an email
app.post('/send', function (req, res, next) {
    if (!req.is('application/json'))
        return next();
    
    if (!req.body.hasOwnProperty('code')) //check for code property
        respond(res, 400, 'Bad Request');
    else if (req.body.code != user.code) //checking to make sure it is the current user
        respond(res, 400, 'Bad Credentials');
    else
        requestHandler.Send(user, req, res);
});

//Sets the flag for a delete request
app.post('/markDelete', function (req, res, next) {
    if (!req.is('application/json'))
        return next();
    datastore.flag = 7;
    datastore.data = '';
    respond(res, 200, 'Success');
});

//Moves an email to trash. If email in trash then delete the email
app.post('/delete', function (req, res, next) {
    if (!req.is('application/json'))
        return next();
    if (!req.body.hasOwnProperty('code')) //check for code property
        respond(res, 400, 'Bad Request');
    else if (req.body.code != user.code) //checking to make sure it is the current user
        respond(res, 400, 'Bad Credentials');
    else
        requestHandler.Delete(user, req, res);
});

//Sets the flag for a restore request
app.post('/markRestore', function (req, res, next) {
    datastore.flag = 8;
    datastore.data = '';
    respond(res, 200, 'Success');
});

//Untrashes an email
app.post('/restore', function (req, res, next) {
    if (!req.is('application/json'))
        return next();
    if (!req.body.hasOwnProperty('code')) //check for code property
        respond(res, 400, 'Bad Request');
    else if (req.body.code != user.code) //checking to make sure it is the current user
        respond(res, 400, 'Bad Credentials');
    else
        requestHandler.Restore(user, req, res);
});

//Sets the flag for a mark label request
app.post('/markMark', function (req, res, next) {
    if (!req.is('application/json'))
        return next();
    datastore.flag = 9;
    datastore.data = req.body.mark; //the requested label to toggle
    respond(res, 200, 'Success');
});

//Toggles a label on an email
app.post('/mark', function (req, res, next) {
    if (!req.is('application/json'))
        return next();
    if (!req.body.hasOwnProperty('code')) //check for code property
        respond(res, 400, 'Bad Request');
    else if (req.body.code != user.code) //checking to make sure it is the current user
        respond(res, 400, 'Bad Credentials');
    else
        requestHandler.ToggleMark(user, req, res);
});

//Sets the flag for a go home request
app.post('/home', function (req, res, next) {
    datastore.flag = 10;
    datastore.data = '';
    respond(res, 200, 'Success');
});

//For testing on localhost:8080
const PORT = process.env.PORT || 8080;
app.listen(PORT, function ()
{
    console.log(`App listening on port ${PORT}`);
    console.log('Press Ctrl+C to quit.');
});