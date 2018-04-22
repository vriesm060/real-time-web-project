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
io.use(sharedsession(session, {
  autoSave: true
}));

// API updates each hour with a 35 min delay for some reason (e.g. 10.00 am update updates at 10.35)
// Polling help: https://github.com/vpdeva/long-poll/blob/master/server.js

var apiClientId = process.env.API_CLIENT_ID;
var apiClientSecret = process.env.API_CLIENT_SECRET;

var pollingTimer;
var database = [];

var toCapitalize = function (str) {
  var firstLetter = str.charAt(0);
  var rest = str.slice(1);
  return firstLetter.toUpperCase() + rest.toLowerCase();
}

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
  getNextHour: function () {
    var date = new Date();
    var minutes = date.getMinutes() * 60;
    var seconds = date.getSeconds();
    var timeTillNextHour = 3600 - (minutes + seconds);
    return timeTillNextHour * 1000;
  },
  pollingLoop: function (socketId, city) {
    api.YQL(city).exec(function (err, data) {
      if (err) throw err;

      var weather = api.getWeatherData(data);

      database.forEach(function (user) {
        if (user.socketId === socketId) {
          // Update the weather property:
          user.weather = weather;

          console.log(user.weather.condition.date);

          // Give the update to the socket:
          api.updateWeather(user.socketId, user.weather);
        }
      });

      // Set a timeout for new update in one hour:
      pollingTimer = setTimeout(function () {
        api.pollingLoop(socketId, city);
      }, api.getNextHour());
    });
  },
  updateWeather: function (socketId, weather) {
    io.to(socketId).emit('update', weather);
  }
};

io.on('connection', function (socket) {
  var user = socket.handshake.session.user;

  // Add socket ID to user obj:
  user.socketId = socket.id;

  // Add new user to database:
  database.push(user);

  // Testing...
  console.log(`user ${user.name} connected,`);
  console.log(`with socketId: ${user.socketId}`);
  console.log(`Connected users: ${database.length}`);

  // Update user's weatherData every hour:
  api.pollingLoop(user.socketId, user.city);

  // Show history of connected users with name, city and current temp:
  if (database.length > 1) {
    database.forEach(function (user) {
      if (user.socketId !== socket.id) {
        socket.emit('users-history', user);
      }
    });
  }

  // Show that the user logged in:
  socket.broadcast.emit('user-login', user);

  socket.on('disconnect', function () {
    if (user) {
      // Show that the user logged out:
      socket.broadcast.emit('user-logout', user);

      // Remove user from database:
      var socketIndex = database.indexOf(user);
      database.splice(socketIndex, 1);

      console.log(`user ${user.name} disconnected`);

      // Delete user from session:
      delete user;

      console.log(`Connected users: ${database.length}`);
    }
  });
});

app.get('/', function (req, res) {
  res.render('index');
});

app.post('/weather', function (req, res) {

  // Get weatherData for selected city from API:
  api.YQL(req.body.city).exec(function (err, data) {
    if (err) throw err;

    var weather = api.getWeatherData(data);

    // Create user obj:
    var user = {
      name: toCapitalize(req.body.name),
      city: req.body.city,
      weather: weather
    };

    // Add user to the session:
    req.session.user = user;

    res.render('weather', {
      user: user
    });
  });

});

http.listen(process.env.LOCALHOST);
