var express = require('express');
var app = express();
var http = require('http').Server(app);

app.use(express.static('public'));
app.set('view engine', 'ejs');

app.get('/', function (req, res) {
  res.render('index');
});

http.listen(3000);
