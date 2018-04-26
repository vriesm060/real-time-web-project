var express = require('express');
var app = express();
var http = require('http').Server(app);
var yql = require('yql');
var io = require('socket.io')(http);
var bodyParser = require('body-parser');
var request = require('request');
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
var googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;

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
      condition: results.item.condition,
      forecast: results.item.forecast,
      svg: getWeatherSVG(results.item.condition.code)[0].svg
    };

    weatherData.forecast.forEach(function (date) {
      date.svg = getWeatherSVG(date.code)[0].svg;
    });

    /*

    weatherData:
    ____________

    location: {
      city, country, region
    },
    units: {
      distance, pressure, speed, temperature
    },
    wind: {
      chill, direction, speed
    },
    condition: {
      code, date, temp, text
    },
    forecast: [
      {
        code, date, day, high, low, text
      }
    ]

    */

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

          // Give the update to the socket:
          api.updateWeather(user);
        }
      });

      // Set a timeout for new update in one hour:
      pollingTimer = setTimeout(function () {
        api.pollingLoop(socketId, city);
      }, api.getNextHour());
    });
  },
  updateWeather: function (user) {
    io.to(user.socketId).emit('update', user);
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

// Location API:
var loc;

app.get('/', function (req, res) {
  if (loc !== null || loc !== undefined) {
    res.render('index', {
      city: loc
    });
  } else {
    res.render('index', {
      city: ''
    });
  }
});

app.get('/location', function (req, res) {
  var url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${req.query.latlng}&result_type=locality&key=${googleMapsApiKey}`;
  request(url, function (err, response, body) {
    var data = JSON.parse(body);
    loc = data.results[0].address_components[0].long_name;
    res.redirect('/');
  });
});

app.get('/weather', function (req, res) {
  var user = {
    name: toCapitalize(req.query.name),
    city: req.query.city
  };

  req.session.user = user;
  res.render('weather');
});

var getWeatherSVG = function (conditionCode) {
  var weatherSVGs = [
    {
      condition: 'sunny',
      svg: `<svg id="condition-svg" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">
              <path class="sun-rays sunny" d="M48,3v12.5c0,1.6-1.3,3-3,3s-3-1.3-3-3V3c0-1.6,1.3-3,3-3S48,1.3,48,3z M13.2,13.2
              c-1.2,1.2-1.2,3,0,4.2l8.9,8.9c1.2,1.2,3,1.2,4.2,0c1.2-1.2,1.2-3,0-4.2l-8.9-8.9C16.2,12,14.3,12,13.2,13.2z M0,45c0,1.6,1.3,3,3,3
              h12.5c1.6,0,3-1.3,3-3s-1.3-3-3-3H3C1.3,42,0,43.4,0,45z M13.2,76.8c1.2,1.2,3,1.2,4.2,0l8.9-8.9c1.2-1.2,1.2-3,0-4.2
              c-1.2-1.2-3-1.2-4.2,0l-8.9,8.9C12,73.8,12,75.7,13.2,76.8z M45,90c1.6,0,3-1.3,3-3V74.5c0-1.6-1.3-3-3-3s-3,1.3-3,3V87
              C42,88.7,43.4,90,45,90z M76.8,76.8c1.2-1.2,1.2-3,0-4.2L68,63.8c-1.2-1.2-3-1.2-4.2,0c-1.2,1.2-1.2,3,0,4.2l8.9,8.9
              C73.8,78,75.7,78,76.8,76.8z M90,45c0-1.6-1.3-3-3-3H74.5c-1.6,0-3,1.3-3,3s1.3,3,3,3H87C88.7,48,90,46.6,90,45z M76.8,13.2
              c-1.2-1.2-3-1.2-4.2,0L63.8,22c-1.2,1.2-1.2,3,0,4.2c1.2,1.2,3,1.2,4.2,0l8.9-8.9C78,16.2,78,14.3,76.8,13.2z"/>
              <path class="sun-body" class="st0" d="M45,24.3c-11.4,0-20.7,9.3-20.7,20.7c0,11.4,9.3,20.7,20.7,20.7S65.7,56.4,65.7,45
              C65.7,33.6,56.4,24.3,45,24.3z M45,59.8c-8.2,0-14.8-6.6-14.8-14.8S36.8,30.2,45,30.2S59.8,36.8,59.8,45S53.2,59.8,45,59.8z"/>
            </svg>`
    },
    {
      condition: 'cloudy',
      svg: `<svg id="condition-svg" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">
              <path class="cloud cloudy" d="M78.1,24.3c0.1-0.6,0.1-1.2,0.1-1.9c0-9-7.1-16.4-15.9-16.4c-3.8,0-7.3,1.4-10,3.6
              c-2.5-3.2-6-5.8-10.1-7.6C30.2-3,16.6,1.6,12,12.4c-1.4,3.3-1.8,6.9-1.3,10.3C4.2,26.6,0,32.8,0,39.7c0,9,7,16.7,17,19.8
              c0.6,2.3,1.6,4.5,3.1,6.6c7,9.7,22,11.5,33.4,4c2.7-1.7,4.9-3.9,6.7-6.2c2.4,0.7,5,1,7.7,1C81.7,65,93,55.4,93,43.7
              C93,35,86.9,27.6,78.1,24.3z M67.9,60.2c-1.8,0-3.5-0.2-5.1-0.6c-1.7-0.4-3.4-1-4.9-1.7c-0.7,1.5-1.6,2.9-2.7,4.2
              c-1.3,1.5-2.8,2.9-4.7,4.1c-8.9,5.8-20.5,4.4-25.9-3.1c-0.5-0.7-1-1.5-1.4-2.2c-0.8-1.6-1.2-3.3-1.4-5c-2-0.4-3.8-1-5.5-1.7
              C10.2,51.2,6,45.9,6,39.7C6,35.1,8.3,31,12.1,28c1.3-1,2.8-1.9,4.4-2.7c-0.5-1.6-0.8-3.3-0.8-5c0-2,0.4-3.9,1.2-5.8
              c3.6-8.4,14.1-12,23.5-8c3.7,1.6,6.6,4,8.6,7c1.2,1.8,2.1,3.7,2.6,5.7c0.6-2.1,1.7-4,3.3-5.4c2-1.8,4.5-2.9,7.4-2.9
              c6.1,0,11.1,5.2,11.1,11.6c0,0.2,0,0.4,0,0.5c-0.1,1.7-0.5,3.3-1.2,4.7c1.6,0.3,3.1,0.8,4.6,1.4c6.3,2.8,10.5,8.3,10.5,14.7
              C87.4,52.8,78.6,60.2,67.9,60.2z"/>
            </svg>`
    },
    {
      condition: 'partly-cloudy',
      svg: `<svg id="condition-svg" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">
              <path class="sun-rays partly-cloudy" d="M77.9,3.9c-1.1-0.6-2.4-0.3-3.1,0.8L70,12.8c-0.6,1.1-0.3,2.4,0.8,3.1
              c1.1,0.6,2.4,0.3,3.1-0.8L78.7,7C79.3,5.9,79,4.5,77.9,3.9z M90.7,23.2l-9.2,2.3c-1.2,0.3-1.9,1.5-1.6,2.7c0.3,1.2,1.5,1.9,2.7,1.6
              l9.2-2.3c1.2-0.3,1.9-1.5,1.6-2.7C93.1,23.6,91.9,22.9,90.7,23.2z M88.8,47.5l-8.1-4.9c-1.1-0.6-2.4-0.3-3.1,0.8
              c-0.6,1.1-0.3,2.4,0.8,3.1l8.1,4.9c1.1,0.6,2.4,0.3,3.1-0.8C90.2,49.5,89.9,48.1,88.8,47.5z M42.5,19.7l-8.1-4.9
              c-1.1-0.6-2.4-0.3-3.1,0.8S31,18,32.1,18.6l8.1,4.9c1.1,0.6,2.4,0.3,3.1-0.8C43.9,21.7,43.5,20.3,42.5,19.7z M52.2,0.1
              c-1.2,0.3-1.9,1.5-1.6,2.7l2.3,9.2c0.3,1.2,1.5,1.9,2.7,1.6c1.2-0.3,1.9-1.5,1.6-2.7l-2.3-9.2C54.6,0.5,53.4-0.2,52.2,0.1z"/>
              <path class="sun-body partly-cloudy" d="M61,16.9c-8.5,0-15.5,7-15.5,15.5c0,0.6,0,1.1,0.1,1.7c0.2,1.6,0.6,3,1.2,4.4
              c0.2-0.2,0.3-0.3,0.5-0.5c1-0.9,2.1-1.6,3.3-2c-0.4-1.1-0.6-2.4-0.6-3.6c0-0.2,0-0.3,0-0.5C50.2,26,55,21.3,61,21.3
              c6.1,0,11.1,5,11.1,11.1c0,4-2.1,7.5-5.3,9.4c-1.2,0.7-2.5,1.2-3.9,1.5c0.2,0.7,0.2,1.5,0.2,2.2c0,0.1,0,0.3,0,0.5
              c0,0.6-0.1,1.2-0.2,1.8c1.5-0.2,3-0.6,4.3-1.2c5.5-2.4,9.3-7.9,9.3-14.2C76.5,23.8,69.5,16.9,61,16.9z"/>
              <path class="cloud" d="M67.2,47.1c0-0.2,0-0.3,0-0.5c0-0.4,0-0.7,0-1.1c0-1.3-0.2-2.5-0.5-3.7
              c-1.6-6-6.9-10.4-13.2-10.4c-1.3,0-2.5,0.2-3.7,0.5c-1.6,0.5-3,1.2-4.3,2.2c-0.2,0.1-0.4,0.3-0.6,0.5c-2.2-2.7-5.1-5-8.7-6.5
              c-10.4-4.4-22.1-0.5-26,8.8c-1.2,2.9-1.6,5.9-1.1,8.9C3.6,49.1,0,54.4,0,60.4c0,7.8,6.1,14.4,14.6,17.1c0.5,2,1.4,3.9,2.6,5.7
              c6,8.3,19,9.9,28.8,3.4c2.3-1.5,4.2-3.3,5.8-5.3c2.1,0.6,4.3,0.9,6.6,0.9c11.9,0,21.6-8.2,21.6-18.3C80,56.4,74.7,50,67.2,47.1z
               M58.4,78c-1.5,0-3-0.2-4.3-0.5c-1.5-0.3-2.9-0.8-4.2-1.5c-0.6,1.3-1.4,2.5-2.3,3.6c-1.1,1.3-2.4,2.5-4,3.5
              c-7.6,5-17.6,3.8-22.3-2.7c-0.5-0.6-0.8-1.3-1.2-1.9c-0.7-1.4-1.1-2.8-1.2-4.3c-1.7-0.3-3.3-0.8-4.7-1.5c-5.4-2.4-9-7.1-9-12.4
              c0-3.9,2-7.5,5.3-10.1c1.1-0.9,2.4-1.7,3.8-2.3c-0.5-1.4-0.7-2.9-0.7-4.3c0-1.7,0.3-3.4,1-5c3.1-7.2,12.1-10.3,20.2-6.9
              c3.1,1.3,5.7,3.5,7.4,6c1.1,1.5,1.8,3.2,2.3,4.9c0.4-1.6,1.3-3,2.4-4.2c0.2-0.2,0.3-0.3,0.5-0.5c1-0.9,2.1-1.6,3.3-2
              c1-0.3,2-0.5,3-0.5c4.6,0,8.4,3.3,9.3,7.8c0.2,0.7,0.2,1.5,0.2,2.2c0,0.1,0,0.3,0,0.5c0,0.6-0.1,1.2-0.2,1.8
              c-0.2,0.8-0.4,1.5-0.8,2.2c1.4,0.3,2.7,0.7,3.9,1.2c5.4,2.4,9.1,7.1,9.1,12.6C75.2,71.7,67.6,78,58.4,78z"/>
            </svg>`
    },
    {
      condition: 'rain',
      svg: `<svg id="condition-svg" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">
              <path class="rain raindrop-three" d="M18.4,67.8c0,0-4.4,6.3-4.4,8.7c0,2.4,1.9,4.4,4.4,4.4c2.4,0,4.4-1.9,4.4-4.4
              C22.7,74.1,18.4,67.8,18.4,67.8"/>
              <path class="rain raindrop-two" d="M60.6,64.1c0,0-4.4,6.3-4.4,8.7s1.9,4.4,4.4,4.4c2.4,0,4.4-1.9,4.4-4.4
              S60.6,64.1,60.6,64.1"/>
              <path class="rain raindrop-one" d="M45.7,76.5c0,0-4.4,6.3-4.4,8.7s1.9,4.4,4.4,4.4c2.4,0,4.4-1.9,4.4-4.4
              S45.7,76.5,45.7,76.5"/>
              <path class="cloud" d="M69.7,21.6c0.1-0.5,0.1-1.1,0.1-1.7c0-8.1-6.4-14.6-14.2-14.6c-3.4,0-6.5,1.2-8.9,3.3
              c-2.3-2.8-5.3-5.2-9-6.7c-10.8-4.6-22.9-0.5-27,9.2c-1.3,3-1.6,6.1-1.2,9.2C3.7,23.7,0,29.2,0,35.4c0,8.1,6.3,14.9,15.1,17.7
              c0.5,2.1,1.4,4,2.7,5.9c6.3,8.6,19.7,10.2,29.8,3.6c2.4-1.6,4.4-3.4,6-5.5c2.2,0.6,4.5,0.9,6.9,0.9C72.9,58,83,49.5,83,39
              C83,31.3,77.5,24.6,69.7,21.6z M60.6,53.7c-1.6,0-3.1-0.2-4.5-0.5c-1.5-0.3-3-0.9-4.4-1.5c-0.6,1.3-1.4,2.6-2.4,3.7
              c-1.1,1.4-2.5,2.6-4.2,3.7C37.3,64.3,26.9,63,22,56.3c-0.5-0.6-0.9-1.3-1.2-2c-0.7-1.4-1.1-2.9-1.2-4.5c-1.7-0.3-3.4-0.9-4.9-1.5
              c-5.6-2.5-9.3-7.3-9.3-12.8c0-4.1,2.1-7.8,5.5-10.5c1.2-0.9,2.5-1.7,3.9-2.4c-0.5-1.5-0.7-3-0.7-4.5c0-1.8,0.3-3.5,1.1-5.2
              c3.2-7.5,12.6-10.7,21-7.1c3.3,1.4,5.9,3.6,7.7,6.2c1.1,1.6,1.9,3.3,2.3,5.1c0.5-1.9,1.6-3.6,2.9-4.9c1.8-1.6,4.1-2.6,6.6-2.6
              c5.5,0,9.9,4.6,9.9,10.4c0,0.2,0,0.3,0,0.5c-0.1,1.5-0.4,2.9-1,4.2c1.4,0.3,2.8,0.7,4.1,1.3C74.2,28.4,78,33.3,78,39
              C78,47.1,70.2,53.7,60.6,53.7z"/>
            </svg>`
    },
    {
      condition: 'hail',
      svg: `<svg id="condition-svg" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">
              <path class="hail hailstone-five" d="M19,70.4c-1.7,0-3,1.3-3,3c0,1.7,1.3,3,3,3c1.7,0,3-1.3,3-3C22,71.7,20.7,70.4,19,70.4"
              />
              <path class="hail hailstone-four" d="M40,69.4c-1.7,0-3,1.3-3,3c0,1.7,1.3,3,3,3c1.7,0,3-1.3,3-3C43,70.7,41.7,69.4,40,69.4"
              />
              <path class="hail hailstone-three" d="M31,80.4c-1.7,0-3,1.3-3,3c0,1.7,1.3,3,3,3c1.7,0,3-1.3,3-3C34,81.7,32.7,80.4,31,80.4
              "/>
              <path class="hail hailstone-two" d="M60,69.4c-1.7,0-3,1.3-3,3c0,1.7,1.3,3,3,3c1.7,0,3-1.3,3-3C63,70.7,61.7,69.4,60,69.4"
              />
              <path class="hail hailstone-one" d="M50,76.4c-1.7,0-3,1.3-3,3c0,1.7,1.3,3,3,3c1.7,0,3-1.3,3-3C53,77.7,51.7,76.4,50,76.4"
              />
              <path class="cloud" d="M69.7,21.6c0.1-0.5,0.1-1.1,0.1-1.7c0-8.1-6.4-14.6-14.2-14.6c-3.4,0-6.5,1.2-8.9,3.3
              c-2.3-2.8-5.3-5.2-9-6.7c-10.8-4.6-22.9-0.5-27,9.2c-1.3,3-1.6,6.1-1.2,9.2C3.7,23.7,0,29.2,0,35.4c0,8.1,6.3,14.9,15.1,17.7
              c0.5,2.1,1.4,4,2.7,5.9c6.3,8.6,19.7,10.2,29.8,3.6c2.4-1.6,4.4-3.4,6-5.5c2.2,0.6,4.5,0.9,6.9,0.9C72.9,58,83,49.5,83,39
              C83,31.3,77.5,24.6,69.7,21.6z M60.6,53.7c-1.6,0-3.1-0.2-4.5-0.5c-1.5-0.3-3-0.9-4.4-1.5c-0.6,1.3-1.4,2.6-2.4,3.7
              c-1.1,1.4-2.5,2.6-4.2,3.7C37.3,64.3,26.9,63,22,56.3c-0.5-0.6-0.9-1.3-1.2-2c-0.7-1.4-1.1-2.9-1.2-4.5c-1.7-0.3-3.4-0.9-4.9-1.5
              c-5.6-2.5-9.3-7.3-9.3-12.8c0-4.1,2.1-7.8,5.5-10.5c1.2-0.9,2.5-1.7,3.9-2.4c-0.5-1.5-0.7-3-0.7-4.5c0-1.8,0.3-3.5,1.1-5.2
              c3.2-7.5,12.6-10.7,21-7.1c3.3,1.4,5.9,3.6,7.7,6.2c1.1,1.6,1.9,3.3,2.3,5.1c0.5-1.9,1.6-3.6,2.9-4.9c1.8-1.6,4.1-2.6,6.6-2.6
              c5.5,0,9.9,4.6,9.9,10.4c0,0.2,0,0.3,0,0.5c-0.1,1.5-0.4,2.9-1,4.2c1.4,0.3,2.8,0.7,4.1,1.3C74.2,28.4,78,33.3,78,39
              C78,47.1,70.2,53.7,60.6,53.7z"/>
            </svg>`
    },
    {
      condition: 'snow',
      svg: `<svg id="condition-svg" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">
              <path class="snow snowflake-four" d="M14.2,82.1c-0.3-0.2-0.7-0.4-1-0.6c0,1,0.1,2.4-1.3,2.4c-1.4,0-1.3-1.4-1.3-2.4
              c-0.9,0.5-2,1.3-2.8,0.1c-0.7-1.2,0.6-1.8,1.5-2.3c-0.9-0.5-2.2-1.1-1.5-2.3c0.7-1.2,1.9-0.4,2.8,0.1c0-1-0.1-2.4,1.3-2.4
              c1.4,0,1.3,1.4,1.3,2.4c0.9-0.5,2-1.3,2.8-0.1c0.7,1.2-0.6,1.8-1.5,2.3c0.8,0.5,2,0.9,1.6,2.1C15.8,82.1,15,82.5,14.2,82.1
              C13.9,81.9,15.7,82.9,14.2,82.1z"/>
              <path class="snow snowflake-three" d="M66.7,70.3c-0.3-0.2-0.7-0.4-1-0.6c0,1,0.1,2.4-1.3,2.4c-1.4,0-1.3-1.4-1.3-2.4
              c-0.9,0.5-2,1.3-2.8,0.1c-0.7-1.2,0.6-1.8,1.5-2.3c-0.9-0.5-2.2-1.1-1.5-2.3c0.7-1.2,1.9-0.4,2.8,0.1c0-1-0.1-2.4,1.3-2.4
              c1.4,0,1.3,1.4,1.3,2.4c0.9-0.5,2-1.3,2.8-0.1c0.7,1.2-0.6,1.8-1.5,2.3c0.8,0.5,2,0.9,1.6,2.1C68.3,70.3,67.5,70.7,66.7,70.3
              C66.4,70.1,68.2,71.1,66.7,70.3z"/>
              <path class="snow snowflake-two" d="M37.9,77.9c-0.3-0.2-0.7-0.4-1-0.6c0,1,0.1,2.4-1.3,2.4c-1.4,0-1.3-1.4-1.3-2.4
              c-0.9,0.5-2,1.3-2.8,0.1c-0.7-1.2,0.6-1.8,1.5-2.3c-0.9-0.5-2.2-1.1-1.5-2.3c0.7-1.2,1.9-0.4,2.8,0.1c0-1-0.1-2.4,1.3-2.4
              c1.4,0,1.3,1.4,1.3,2.4c0.9-0.5,2-1.3,2.8-0.1c0.7,1.2-0.6,1.8-1.5,2.3c0.8,0.5,2,0.9,1.6,2.1C39.5,77.9,38.6,78.3,37.9,77.9
              C37.5,77.7,39.3,78.7,37.9,77.9z"/>
              <path class="snow snowflake-one" d="M57.5,87.7c-0.3-0.2-0.7-0.4-1-0.6c0,1,0.1,2.4-1.3,2.4c-1.4,0-1.3-1.4-1.3-2.4
              c-0.9,0.5-2,1.3-2.8,0.1c-0.7-1.2,0.6-1.8,1.5-2.3c-0.9-0.5-2.2-1.1-1.5-2.3c0.7-1.2,1.9-0.4,2.8,0.1c0-1-0.1-2.4,1.3-2.4
              c1.4,0,1.3,1.4,1.3,2.4c0.9-0.5,2-1.3,2.8-0.1c0.7,1.2-0.6,1.8-1.5,2.3c0.8,0.5,2,0.9,1.6,2.1C59.1,87.7,58.3,88.1,57.5,87.7
              C57.2,87.5,59,88.5,57.5,87.7z"/>
              <path class="cloud" d="M69.7,21.6c0.1-0.5,0.1-1.1,0.1-1.7c0-8.1-6.4-14.6-14.2-14.6c-3.4,0-6.5,1.2-8.9,3.3
              c-2.3-2.8-5.3-5.2-9-6.7c-10.8-4.6-22.9-0.5-27,9.2c-1.3,3-1.6,6.1-1.2,9.2C3.7,23.7,0,29.2,0,35.4c0,8.1,6.3,14.9,15.1,17.7
              c0.5,2.1,1.4,4,2.7,5.9c6.3,8.6,19.7,10.2,29.8,3.6c2.4-1.6,4.4-3.4,6-5.5c2.2,0.6,4.5,0.9,6.9,0.9C72.9,58,83,49.5,83,39
              C83,31.3,77.5,24.6,69.7,21.6z M60.6,53.7c-1.6,0-3.1-0.2-4.5-0.5c-1.5-0.3-3-0.9-4.4-1.5c-0.6,1.3-1.4,2.6-2.4,3.7
              c-1.1,1.4-2.5,2.6-4.2,3.7C37.3,64.3,26.9,63,22,56.3c-0.5-0.6-0.9-1.3-1.2-2c-0.7-1.4-1.1-2.9-1.2-4.5c-1.7-0.3-3.4-0.9-4.9-1.5
              c-5.6-2.5-9.3-7.3-9.3-12.8c0-4.1,2.1-7.8,5.5-10.5c1.2-0.9,2.5-1.7,3.9-2.4c-0.5-1.5-0.7-3-0.7-4.5c0-1.8,0.3-3.5,1.1-5.2
              c3.2-7.5,12.6-10.7,21-7.1c3.3,1.4,5.9,3.6,7.7,6.2c1.1,1.6,1.9,3.3,2.3,5.1c0.5-1.9,1.6-3.6,2.9-4.9c1.8-1.6,4.1-2.6,6.6-2.6
              c5.5,0,9.9,4.6,9.9,10.4c0,0.2,0,0.3,0,0.5c-0.1,1.5-0.4,2.9-1,4.2c1.4,0.3,2.8,0.7,4.1,1.3C74.2,28.4,78,33.3,78,39
              C78,47.1,70.2,53.7,60.6,53.7z"/>
            </svg>`
    },
    {
      condition: 'thunder',
      svg: `<svg id="condition-svg" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">
              <polygon class="bolt" points="29.5,64.5 34.8,69.8 29.5,85.8 45.5,69.8 40.2,64.5 45.5,48.5 "/>
              <path class="cloud" d="M69.7,21.6c0.1-0.5,0.1-1.1,0.1-1.7c0-8.1-6.4-14.6-14.2-14.6c-3.4,0-6.5,1.2-8.9,3.3
              c-2.3-2.8-5.3-5.2-9-6.7c-10.8-4.6-22.9-0.5-27,9.2c-1.3,3-1.6,6.1-1.2,9.2C3.7,23.7,0,29.2,0,35.4c0,8.1,6.3,14.9,15.1,17.7
              c0.5,2.1,1.4,4,2.7,5.9c1.6,2.2,3.7,4,6.1,5.2l1.9-4.4c-1.5-0.9-2.8-2.1-3.9-3.6c-0.5-0.6-0.9-1.3-1.2-2c-0.7-1.4-1.1-2.9-1.2-4.5
              c-1.7-0.3-3.4-0.9-4.9-1.5c-5.6-2.5-9.3-7.3-9.3-12.8c0-4.1,2.1-7.8,5.5-10.5c1.2-0.9,2.5-1.7,3.9-2.4c-0.5-1.5-0.7-3-0.7-4.5
              c0-1.8,0.3-3.5,1.1-5.2c3.2-7.5,12.6-10.7,21-7.1c3.3,1.4,5.9,3.6,7.7,6.2c1.1,1.6,1.9,3.3,2.3,5.1c0.5-1.9,1.6-3.6,2.9-4.9
              c1.8-1.6,4.1-2.6,6.6-2.6c5.5,0,9.9,4.6,9.9,10.4c0,0.2,0,0.3,0,0.5c-0.1,1.5-0.4,2.9-1,4.2c1.4,0.3,2.8,0.7,4.1,1.3
              C74.2,28.4,78,33.3,78,39c0,8.1-7.8,14.8-17.4,14.8c-1.6,0-3.1-0.2-4.5-0.5c-1.5-0.3-3-0.9-4.4-1.5c-0.6,1.3-1.4,2.6-2.4,3.7
              c-0.7,0.8-1.5,1.6-2.3,2.3l3.3,2.9c1.3-1.1,2.5-2.3,3.4-3.6c2.2,0.6,4.5,0.9,6.9,0.9C72.9,58,83,49.5,83,39
              C83,31.3,77.5,24.6,69.7,21.6z"/>
            </svg>`
    },
    {
      condition: 'fog',
      svg: `<svg id="condition-svg" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">
              <path class="fog bank-two" d="M9.4,77.2c21.2,0,51.4,0,72.7,0c3.2,0,3.2-5,0-5c-21.2,0-51.4,0-72.7,0
              C6.2,72.2,6.2,77.2,9.4,77.2L9.4,77.2z"/>
              <path class="fog bank-one" d="M2.4,86c21.2,0,47.4,0,68.7,0c3.2,0,3.2-5,0-5c-21.2,0-47.4,0-68.7,0C-0.8,81-0.8,86,2.4,86
              L2.4,86z"/>
              <path class="cloud" d="M72.3,21.6c0.1-0.5,0.1-1.1,0.1-1.7c0-8.1-6.4-14.6-14.2-14.6c-3.4,0-6.5,1.2-8.9,3.3
              c-2.3-2.8-5.3-5.2-9-6.7c-10.8-4.6-22.9-0.5-27,9.2c-1.3,3-1.6,6.1-1.2,9.2c-5.8,3.5-9.5,9-9.5,15.2c0,8.1,6.3,14.9,15.1,17.7
              c0.5,2.1,1.4,4,2.7,5.9c6.3,8.6,19.7,10.2,29.8,3.6c2.4-1.6,4.4-3.4,6-5.5c2.2,0.6,4.5,0.9,6.9,0.9c12.4,0,22.4-8.5,22.4-19
              C85.6,31.3,80.1,24.6,72.3,21.6z M63.1,53.7c-1.6,0-3.1-0.2-4.5-0.5c-1.5-0.3-3-0.9-4.4-1.5c-0.6,1.3-1.4,2.6-2.4,3.7
              c-1.1,1.4-2.5,2.6-4.2,3.7c-7.9,5.2-18.3,3.9-23.2-2.8c-0.5-0.6-0.9-1.3-1.2-2c-0.7-1.4-1.1-2.9-1.2-4.5c-1.7-0.3-3.4-0.9-4.9-1.5
              c-5.6-2.5-9.3-7.3-9.3-12.8c0-4.1,2.1-7.8,5.5-10.5c1.2-0.9,2.5-1.7,3.9-2.4c-0.5-1.5-0.7-3-0.7-4.5c0-1.8,0.3-3.5,1.1-5.2
              c3.2-7.5,12.6-10.7,21-7.1c3.3,1.4,5.9,3.6,7.7,6.2c1.1,1.6,1.9,3.3,2.3,5.1c0.5-1.9,1.6-3.6,2.9-4.9c1.8-1.6,4.1-2.6,6.6-2.6
              c5.5,0,9.9,4.6,9.9,10.4c0,0.2,0,0.3,0,0.5c-0.1,1.5-0.4,2.9-1,4.2c1.4,0.3,2.8,0.7,4.1,1.3c5.6,2.5,9.4,7.4,9.4,13.1
              C80.5,47.1,72.7,53.7,63.1,53.7z"/>
            </svg>`
    },
    {
      condition: 'breeze',
      svg: `<svg id="condition-svg" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">
              <path class="breeze breeze-two" d="M8.2,75.7c21.2,0,12.4,0,33.7,0c3.2,0,3.2-5,0-5c-21.2,0-12.4,0-33.7,0
              C5,70.7,5,75.7,8.2,75.7L8.2,75.7z"/>
              <path class="breeze breeze-one" d="M2.4,65.7c21.2,0,3.2,0,24.5,0c3.2,0,3.2-5,0-5c-21.2,0-3.2,0-24.5,0
              C-0.8,60.7-0.8,65.7,2.4,65.7L2.4,65.7z"/>
              <path class="cloud windy" d="M80,20.3c0.1-0.5,0.1-1,0.1-1.6c0-7.6-6-13.7-13.3-13.7c-3.2,0-6.1,1.1-8.4,3.1
              c-2.1-2.7-5-4.9-8.4-6.3c-10.1-4.3-21.5-0.4-25.4,8.6c-1.2,2.8-1.5,5.8-1.1,8.7c-5.4,3.3-8.9,8.4-8.9,14.3c0,7.6,5.9,14,14.2,16.6
              c0.5,1.9,1.3,3.8,2.6,5.5c5.9,8.1,18.5,9.6,28,3.4c2.2-1.5,4.1-3.2,5.6-5.2c2,0.6,4.2,0.9,6.5,0.9c11.6,0,21.1-8,21.1-17.9
              C92.5,29.4,87.4,23.1,80,20.3z M71.4,50.5c-1.5,0-2.9-0.2-4.2-0.5c-1.5-0.3-2.8-0.8-4.1-1.5c-0.6,1.2-1.3,2.4-2.2,3.5
              c-1.1,1.3-2.4,2.5-3.9,3.4c-7.4,4.9-17.2,3.7-21.8-2.6c-0.4-0.6-0.8-1.2-1.1-1.9c-0.6-1.3-1-2.8-1.2-4.2c-1.6-0.3-3.2-0.8-4.6-1.4
              c-5.2-2.4-8.8-6.9-8.8-12.1c0-3.8,2-7.3,5.1-9.8c1.1-0.9,2.3-1.6,3.7-2.2c-0.4-1.4-0.7-2.8-0.7-4.2c0-1.6,0.3-3.3,1-4.9
              c3-7,11.8-10,19.7-6.7c3.1,1.3,5.5,3.4,7.2,5.8c1,1.5,1.8,3.1,2.2,4.8c0.5-1.8,1.5-3.4,2.8-4.6C62.2,10,64.4,9,66.8,9
              c5.2,0,9.3,4.4,9.3,9.7c0,0.2,0,0.3,0,0.4c-0.1,1.4-0.4,2.7-1,3.9c1.4,0.3,2.6,0.7,3.8,1.2c5.2,2.3,8.8,7,8.8,12.3
              C87.8,44.3,80.4,50.5,71.4,50.5z"/>
            </svg>`
    }
  ];

  var condition;

  switch (Number(conditionCode)) {
    case 0:
    case 1:
    case 2:
      condition = 'breeze';
      break;
    case 3:
    case 4:
      condition = 'thunder';
      break;
    case 5:
      condition = 'snow';
      break;
    case 6:
    case 7:
      condition = 'hail';
      break;
    case 8:
      condition = 'snow';
      break;
    case 9:
    case 10:
    case 11:
    case 12:
      condition = 'rain';
      break;
    case 13:
    case 14:
    case 15:
    case 16:
      condition = 'snow';
      break;
    case 17:
      condition = 'hail';
      break;
    case 18:
      condition = 'rain';
      break;
    case 19:
    case 20:
    case 21:
    case 22:
      condition = 'fog';
      break;
    case 23:
    case 24:
      condition = 'breeze';
      break;
    case 25:
    case 26:
    case 27:
    case 28:
      condition = 'cloudy';
      break;
    case 29:
    case 30:
      condition = 'partly-cloudy';
      break;
    case 31:
    case 32:
    case 33:
    case 34:
      condition = 'sunny';
      break;
    case 35:
      condition = 'hail';
      break;
    case 36:
      condition = 'sunny';
      break;
    case 37:
    case 38:
    case 39:
      condition = 'thunder';
      break;
    case 40:
      condition = 'rain';
      break;
    case 41:
    case 42:
    case 43:
      condition = 'snow';
      break;
    case 44:
      condition = 'partly cloudy';
      break;
    case 45:
      condition = 'thunder';
      break;
    case 46:
      condition = 'snow';
      break;
    case 47:
      condition = 'thunder';
  }

  var svg = weatherSVGs.filter(function (weatherSVG) {
    if (weatherSVG.condition === condition) {
      return weatherSVG;
    }
  });

  return svg;
}

http.listen(process.env.LOCALHOST);
