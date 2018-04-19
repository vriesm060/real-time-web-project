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
var connectionsArr = [];

var pollingloop = function () {
  var query = new yql(queries.getAllFromAmsterdam);

  query.exec(function(err, data) {

    if (err) throw err;

    var results = data.query.results.channel;

    console.log(`Created: ${data.query.created}`);
    console.log(`pubDate: ${results.item.pubDate}`);

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

    if (connectionsArr.length) {
      pollingTimer = setTimeout(pollingloop, 60000);

      updateSockets({
        temp: weatherData.condition.temp,
        pubDate: weatherData.pubDate
      });
    }

  });
}

io.sockets.on('connection', function (socket) {
  console.log('a user connected');
  connectionsArr.push(socket);
  console.log(`number of connections: ${connectionsArr.length}`);

  if (connectionsArr.length) {
    pollingloop();
  }

  socket.on('disconnect', function () {
    var socketIndex = connectionsArr.indexOf(socket);
    console.log(`user ${socketIndex} disconnected`);
    if (socketIndex >= 0) {
      connectionsArr.splice(socketIndex, 1);
    }
  });
});

var updateSockets = function (data) {
  data.time = new Date();

  connectionsArr.forEach(function (tmpSocket) {
    io.emit('update', data);
  });
}

// Get homepage:

app.get('/', function (req, res) {
  res.render('index');
});

http.listen(process.env.LOCALHOST);
