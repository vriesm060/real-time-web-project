var express = require('express');
var app = express();
var http = require('http').Server(app);
var yql = require('yql');
var io = require('socket.io')(http);
var bodyParser = require('body-parser');
var session = require('express-session')({
  secret: 'keyboard cat',
  resave: true,
  saveUninitialized: true
});
var sharedsession = require('express-socket.io-session');
require('dotenv').config({ path: './vars.env' });

app.use(express.static('public'));
app.use(session);
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');

// API updates each hour with a 35 min delay for some reason (e.g. 10.00 am update updates at 10.35)

// Polling help: https://github.com/vpdeva/long-poll/blob/master/server.js

var apiClientId = process.env.API_CLIENT_ID;
var apiClientSecret = process.env.API_CLIENT_SECRET;

// Get the remaining time till next hour:
var getNextHour = function () {
  var date = new Date();
  var minutes = date.getMinutes() * 60;
  var seconds = date.getSeconds();
  var timeTillNextHour = 3600 - (minutes + seconds);
  return timeTillNextHour * 1000;
}

var pollingTimer;
var database = [];

var api = {
  query: function (city) { return `select * from weather.forecast where woeid in (select woeid from geo.places(1) where text='${city.toLowerCase()}') and u='c'`; },
  YQL: function (city) { return new yql(this.query(city)); },
  getWeatherData: function (data) {
    var results = data.query.results.channel;
    var weatherData = {
      location: results.location,
      units: results.units,
      wind: results.wind,
      atmosphere: results.atmosphere,
      astronomy: results.astronomy,
      condition: results.item.condition,
      forecast: results.item.forecast
    };
    return weatherData;
  },
  pollingLoop: function (socketId, city) {
    api.YQL(city).exec(function (err, data) {
      if (err) throw err;

      var weather = api.getWeatherData(data);

      database.forEach(function (user) {
        if (user.socketId === socketId) {
          user.weather = weather;
          console.log(user.weather.condition.date);
          updateSocket(user.socketId, user.weather);
        }
      });

      pollingTimer = setTimeout(function () {
        api.pollingLoop(socketId, city);
      }, getNextHour());
    });
  }
};

io.use(sharedsession(session, {
  autoSave: true
}));

io.on('connection', function (socket) {
  socket.handshake.session.user.socketId = socket.id;
  socket.handshake.session.user.sessionId = socket.handshake.session.id;

  // Add new user to database:
  database.push(socket.handshake.session.user);

  // Testing...
  console.log(`user ${socket.handshake.session.user.name} connected,`);
  console.log(`with socketId: ${socket.handshake.session.user.socketId}`);
  console.log(`Connected users: ${database.length}`);

  // Update user's weatherData every hour:
  api.pollingLoop(socket.id, socket.handshake.session.user.city);

  // Show history of connected users with name, city and current temp:
  if (database.length > 1) {
    database.forEach(function (user) {
      if (user.socketId !== socket.id) {
        socket.emit('user-login', user);
      }
    });
  }

  // Show new connected users with name, city and current temp:
  socket.broadcast.emit('user-login', socket.handshake.session.user);

  socket.on('disconnect', function () {
    if (socket.handshake.session.user) {

      // Show disconnected users:
      socket.broadcast.emit('user-logout', socket.handshake.session.user);

      // Remove user from database:
      var socketIndex = database.indexOf(socket.handshake.session.user);
      database.splice(socketIndex, 1);

      console.log(`user ${socket.handshake.session.user.name} disconnected`);
      delete socket.handshake.session.user;
      console.log(`Connected users: ${database.length}`);
    }
  });
});

var updateSocket = function (socketId, weather) {
  io.to(socketId).emit('update', weather);
}

// Get homepage:

app.get('/', function (req, res) {
  res.render('index');
});

app.get('/weather', function (req, res) {

  // Get weatherData from API:
  api.YQL(req.query.city).exec(function (err, data) {
    if (err) throw err;

    var weather = api.getWeatherData(data);

    var user = {
      name: req.query.name,
      city: req.query.city,
      weather: weather
    };

    req.session.user = user;

    res.render('weather', {
      user: user
    });
  });

});

http.listen(process.env.LOCALHOST);
