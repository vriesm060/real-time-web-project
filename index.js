var express = require('express');
var app = express();
var http = require('http').Server(app);
var yql = require('yql');
var io = require('socket.io')(http);
var session = require('express-session')({
  secret: 'keyboard cat',
  resave: true,
  saveUninitialized: true
});
var sharedsession = require('express-socket.io-session');
require('dotenv').config({ path: './vars.env' });

app.use(express.static('public'));
app.use(session);
app.set('view engine', 'ejs');

// API updates each hour with a 35 min delay for some reason (e.g. 10.00 am update updates at 10.35)

// Polling help: https://github.com/vpdeva/long-poll/blob/master/server.js

var apiClientId = process.env.API_CLIENT_ID;
var apiClientSecret = process.env.API_CLIENT_SECRET;

var query = function (city) {
  return `select * from weather.forecast where woeid in (select woeid from geo.places(1) where text='${city.toLowerCase()}') and u='c'`;
}

var pollingTimer;

var cities = [];

var connectedSockets = [];
var database = [];

var pollingLoop = function (city) {
  // Make a new yahoo query:
  var YQL = new yql(query(city));

  // Execute this query:
  YQL.exec(function(err, data) {
    if (err) throw err;

    var results = data.query.results.channel;

    console.log(`Created: ${data.query.created}`);
    console.log(`pubDate: ${results.item.pubDate}`);

    // Get the wanted weather data as an object:
    var weatherData = {
      location: results.location,
      units: results.units,
      lastBuildDate: results.lastBuildDate,
      wind: results.wind,
      atmosphere: results.atmosphere,
      astronomy: results.astronomy,
      pubDate: results.item.pubDate,
      condition: results.item.condition,
      forecast: results.item.forecast
    };

    // When there are clients connected:
    if (database.length) {
      // Update the pollingTimer:
      pollingTimer = setTimeout(function () {
        pollingLoop(city);
      }, 36000000);

      // Update the sockets:
      updateSockets(weatherData);
    }

  });
}

io.use(sharedsession(session, {
    autoSave:true
}));

io.on('connection', function (socket) {
  console.log(`User ${socket.handshake.session.client.name} connected`);

  connectedSockets.push(socket);

  var socketIndex = database.indexOf(socket.handshake.session.client);

  cities.push(socket.handshake.session.client.city);

  cities.forEach(function (city) {
    pollingLoop(city);
  });

  socket.on('disconnect', function () {
    if (socket.handshake.session.client) {
      console.log(`User ${socket.handshake.session.client.name} disconnected`);
      delete socket.handshake.session.client;
      database.splice(socketIndex, 1);
    }
    console.log(`Clients in database: ${database.length}`);
  });
});

var updateSockets = function (weatherData) {
  connectedSockets.forEach(function (socket) {
    socket.emit('update', weatherData);
  });
}

// Get homepage:

app.get('/', function (req, res) {
  res.render('index');
});

app.get('/weather', function (req, res) {

  req.session.client = {
    id: req.session.id,
    name: req.query.name,
    city: req.query.city
  };

  database.push(req.session.client);

  res.render('weather');
});

http.listen(process.env.LOCALHOST);
