var express = require('express');
var app = express();
var http = require('http').Server(app);
var yql = require('yql');
require('dotenv').config({ path: './vars.env' });

app.use(express.static('public'));
app.set('view engine', 'ejs');

var apiClientId = process.env.API_CLIENT_ID;
var apiClientSecret = process.env.API_CLIENT_SECRET;

var queries = {
  getAllFromAmsterdam: 'select * from weather.forecast where woeid = 727232 and u="c"'
};

// Api test:

var query = new yql(queries.getAllFromAmsterdam);

var weatherData;

query.exec(function(err, data) {
  var results = data.query.results.channel;

  console.log(data.query.created);

  weatherData = {
    units: results.units,
    lastBuildDate: results.lastBuildDate,
    wind: results.wind,
    atmosphere: results.atmosphere,
    astronomy: results.astronomy,
    pubDate: results.item.pubDate,
    condition: results.item.condition,
    forecast: results.item.forecast
  };

});

// Get homepage:

app.get('/', function (req, res) {

  console.log(weatherData.pubDate);
  console.log(weatherData.lastBuildDate);

  res.render('index', {
    temp: weatherData.condition.temp,
    pubDate: weatherData.pubDate
  });
});

http.listen(process.env.LOCALHOST);
