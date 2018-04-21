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
var cities = [];
var connectedSockets = [];
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
  }
};

// Update all cities every hour:
// var pollingLoop = function () {
//   if (cities.length) {
//     cities.forEach(function (city) {
//
//       // Make a new yahoo query:
//       var YQL = new yql(query(city));
//
//       // Execute this query:
//       YQL.exec(function(err, data) {
//         if (err) throw err;
//
//         var results = data.query.results.channel;
//
//         // Get the wanted weather data as an object:
//         var weatherData = {
//           location: results.location,
//           units: results.units,
//           lastBuildDate: results.lastBuildDate,
//           wind: results.wind,
//           atmosphere: results.atmosphere,
//           astronomy: results.astronomy,
//           pubDate: results.item.pubDate,
//           condition: results.item.condition,
//           forecast: results.item.forecast
//         };
//
//         // When there are clients connected:
//         if (database.length) {
//           database.forEach(function (client) {
//             if (city === client.city) {
//               client.weatherData = weatherData;
//               updateSockets(client);
//             }
//           });
//         }
//
//         // Add interpolling:
//
//         // console.log(`curTemp: ${weatherData.condition.temp}`);
//         // console.log(results);
//
//       });
//     });
//     console.log('update');
//     pollingTimer = setTimeout(pollingLoop, getNextHour());
//   }
// }

io.use(sharedsession(session, {
  autoSave: true
}));

// io.on('connection', function (socket) {
//   console.log(`User ${socket.handshake.session.client.name} connected`);
//   console.log(`Users in database: ${database.length}`);
//
//   connectedSockets.push(socket);
//   var socketIndex = connectedSockets.indexOf(socket);
//   database[socketIndex].id = socket.id;
//
//   console.log(`Connected Sockets: ${connectedSockets.length}`);
//
//   cities.push(socket.handshake.session.client.city);
//
//   pollingLoop();
//
//   socket.on('disconnect', function () {
//     if (socket.handshake.session.client) {
//       console.log(`User ${socket.handshake.session.client.name} disconnected`);
//       delete socket.handshake.session.client;
//       database.splice(socketIndex, 1);
//       connectedSockets.splice(socketIndex, 1);
//       console.log(`Users in database: ${database.length}`);
//       console.log(`Connected Sockets: ${connectedSockets.length}`);
//     }
//   });
// });

io.on('connection', function (socket) {
  socket.handshake.session.user.socketId = socket.id;
  socket.handshake.session.user.sessionId = socket.handshake.session.id;

  console.log(`user ${socket.handshake.session.user.name} connected,`);
  console.log(`with socketId: ${socket.handshake.session.user.socketId}`);

  // Add new user to database:
  database.push(socket.handshake.session.user);

  // Update user's weatherData every hour:

  // Show history of connected users with name, city and current temp:
  if (database.length > 1) {
    database.forEach(function (user) {
      if (user.socketId !== socket.id) {
        socket.emit('history', user);
      }
    });
  }

  // Show new connected users with name, city and current temp:
  socket.broadcast.emit('new-user', socket.handshake.session.user);

  socket.on('disconnect', function () {
    console.log('a user disconnected');
  });
});

var updateSockets = function (client) {
  io.to(client.id).emit('update', client.weatherData);
}

var showActiveClients = function () {
  console.log();
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
