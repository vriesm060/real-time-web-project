var express = require('express');
var app = express();
var http = require('http').Server(app);
var yql = require('yql');
var io = require('socket.io')(http);
require('dotenv').config({ path: './vars.env' });

app.use(express.static('public'));
app.set('view engine', 'ejs');

var apiClientId = process.env.API_CLIENT_ID;
var apiClientSecret = process.env.API_CLIENT_SECRET;

var queries = {
  getAllFromAmsterdam: 'select * from weather.forecast where woeid = 727232 and u="c"'
};

// Polling:
// help: https://github.com/vpdeva/long-poll/blob/master/server.js

var pollingTimer;
var connectedClients = [];

var pollingLoop = function () {
  // Make a new yahoo query:
  var query = new yql(queries.getAllFromAmsterdam);

  // Execute this query:
  query.exec(function(err, data) {
    if (err) throw err;

    var results = data.query.results.channel;

    console.log(`Created: ${data.query.created}`);
    console.log(`pubDate: ${results.item.pubDate}`);

    // Get the wanted weather data as an object:
    var weatherData = {
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
    if (connectedClients.length) {
      // Update the pollingTimer:
      pollingTimer = setTimeout(pollingLoop, 60000);

      // Update the sockets:
      updateSockets(weatherData);
    }

  });
}

io.sockets.on('connection', function (socket) {
  console.log('a user connected');
  connectedClients.push(socket);
  console.log(`number of connections: ${connectedClients.length}`);

  // When there are clients connected:
  if (connectedClients.length) {
    pollingLoop();
  }

  socket.on('disconnect', function () {
    var socketIndex = connectedClients.indexOf(socket);
    console.log(`user ${socketIndex} disconnected`);
    if (socketIndex >= 0) {
      connectedClients.splice(socketIndex, 1);
    }
  });
});

var updateSockets = function (weatherData) {
  // Add the current time as a property in the weather data object:
  weatherData.time = new Date();

  // For each connected client:
  connectedClients.forEach(function (client) {
    // Send the updated weather data:
    client.emit('update', weatherData);
  });
}

// Get homepage:

app.get('/', function (req, res) {
  res.render('index');
});

http.listen(process.env.LOCALHOST);
