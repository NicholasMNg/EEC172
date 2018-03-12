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
        database: process.env.SQL_DATABASE
	};

     if (process.env.INSTANCE_CONNECTION_NAME && process.env.NODE_ENV === 'production') 
        config.socketPath = `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}`; //sets path to databse
    
    if (process.env.NODE_ENV != 'production') { // This is for when the program is not deployed onto GoogleApp engine
        config.host = '35.227.155.1'; 
        config.user = 'eec172';
        config.password = 'eec172';
        config.database = 'email-users';
    }

    var knex = Knex({ //initialize connection with config properties
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
    flag: 0, //action to be performed: 0-nothing, 1-logout, 2-navigate, 3-compose, 
             //4-writeSubject, 5-writeMessage, 6-send(echo)
    data: '' //data to send CC3200
}

function respond (res, status, message)
{
    res.status(status)
        .set('Content-Type', 'text/plain')
        .send(message)
        .end();
}

//Routing Handlers

app.get('/oauth2callback', function (req, res, next) {
    requestHandler.OAuth2CB(knex, req, res);
});

app.get('/logout', function (req, res, next) {
    datastore.flag = 1;
    datastore.data = '';
    respond(res, 200, 'Pending Log Out');
});

app.post('/timer', function (req, res, next) {
    if (!req.is('application/json'))
        return next();
    if (req.body.hasOwnProperty('code'))
        respond(res, 400, 'Bad Request');
    else if (req.body.code != user.code)
        respond(res, 400, 'Bad Credentials');
    else
    {
        respond(res, 200, JSON.stringify(datastore));
        
        if (datastore.flag == 1)
            user = {
                email: '',
                code: '',
                token: ''
            };

        datastore = {
            flag: 0,
            data: ''
        };
    }
});

app.post('/register', function (req, res, next) {
    if (!req.is('application/json'))
        return next();
    requestHandler.Register(knex, req, res);
});

app.post('/login', function (req, res, next) {
    if (!req.is('application/json'))
        return next();
    requestHandler.Login(knex, req, res, LoginCallback);
    function LoginCallback (newUser)
    {
        user = newUser;
        console.log('User Login');
        console.log(user);
    }
});

app.post('/navigate', function (req, res, next) {
    if (!req.is('application/json'))
        return next();
    if (!req.body.hasOwnProperty('code'))
        respond(res, 400, 'Bad Request');
    else if (req.body.code != user.code)
        respond(res, 400, 'Bad Credentials');
    else
        requestHandler.Navigate(user, req, res, StoreFetch);

    function StoreFetch (fetched)
    {
        datastore.flag = 2;
        datastore.data = fetched;
    }
});

app.post('/fetch', function (req, res, next) {
    if (!req.is('application/json'))
        return next();
    if (!req.body.hasOwnProperty('code'))
        respond(res, 400, 'Bad Request');
    else if (req.body.code != user.code)
        respond(res, 400, 'Bad Credentials');
    else
        requestHandler.Fetch(user, req, res);
});

app.post('/compose', function (req, res, next) {
    datastore.flag = 3;
    datastore.data = '';
    respond(res, 200, 'Success');
});

app.post('/writeSubject', function (req, res, next) {
    if (!req.is('application/json'))
        return next();
    datastore.flag = 4;
    datastore.data = req.body.subject;
    respond(res, 200, 'Success');
});

app.post('/writeMessage', function (req, res, next) {
    if (!req.is('application/json'))
        return next();
    datastore.flag = 5;
    datastore.data = req.body.message;
    respond(res, 200, 'Success');
});

app.post('/commandSend', function (req, res, next) {
    if (!req.is('application/json'))
        return next();
    datastore.flag = 6;
    datastore.data = req.body.message;
    respond(res, 200, 'Success');
});

app.post('/send', function (req, res, next) {
    if (!req.is('application/json'))
        return next();
    
    if (!req.body.hasOwnProperty('code'))
        respond(res, 400, 'Bad Request');
    else if (req.body.code != user.code)
        respond(res, 400, 'Bad Credentials');
    else
    {
        datastore = {
            flag: 0,
            data: ''
        };
        requestHandler.Send(user, req, res);
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, function ()
{
    console.log(`App listening on port ${PORT}`);
    console.log('Press Ctrl+C to quit.');
});