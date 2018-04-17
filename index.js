var express = require('express');
var app = express();
var http = require('http').Server(app);
var yql = require('yql');
var request = require('request');
var bodyParser = require('body-parser');
require('dotenv').config({ path: './vars.env' });

app.use(express.static('public'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');

var apiClientId = process.env.API_CLIENT_ID;
var apiClientSecret = process.env.API_CLIENT_SECRET;

var queries = {
  getAllFromAmsterdam: 'select * from weather.forecast where woeid = 727232 and u="c"'
};

// Api test:

var url = 'https://query.yahooapis.com/v1/public/yql?format=json&q=' + queries.getAllFromAmsterdam;

// Get homepage:

var weatherData;

app.get('/', function (req, res) {

    request(url, function (err, response, body) {
      var data = JSON.parse(body);

      var results = data.query.results.channel;

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

      console.log(weatherData.pubDate);

    });

    console.log(`ID: ${apiClientId}, Secret: ${apiClientSecret}`);
    res.render('index', {
      temp: weatherData.condition.temp,
      pubDate: weatherData.pubDate
    });


});

http.listen(process.env.LOCALHOST);
