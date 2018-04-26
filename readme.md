# Real-Time Weather App

![Preview](screenshots/preview.png)

This is a real-time weather app, created using the [Yahoo Weather API](https://developer.yahoo.com/weather/).

## Installation

In order to install this app on your local computer, fork this repo, then run `git clone` in your terminal and install the packages with npm, using `npm install`.

## Getting started

To start the app locally, run `npm start`. The server will run by default on port 3000.

## Frameworks and packages

* [x] [Dotenv](https://www.npmjs.com/package/dotenv)
* [x] [EJS](http://ejs.co/)
* [x] [Express](expressjs.com)
* [x] [Express session](https://github.com/expressjs/session)
* [x] [Express socket.io session](https://www.npmjs.com/package/express-socket.io-session)
* [x] [Request](https://www.npmjs.com/package/request)
* [x] [Socket.io](http://socket.io/)
* [x] [YQL](https://www.npmjs.com/package/yql)

## Features

* [x] Current weather for a city of your choice
* [x] Weather updates every hour without refreshing the page
* [x] Using your current location
* [x] Weather forecast for the coming days
* [x] Real-time updates on new users logging in or out with their chosen location

## Data Life cycle

## Usage

With this app, users can log in with a name and a city and get the current weather information for this city, including forecast for the following days. This information will be updated every hour. Users can see where other users are and what the weather is in those cities.

#### Yahoo Weather API
---

The [Yahoo Weather API](https://developer.yahoo.com/weather/) can give you the current weather information for a chosen location. The API returns data like the current location, the current temperature, wind direction and speed and the forecast for the following days.

The API updates it's data every hour, so the app makes an API call every hour using polling.

The API uses a query parser called YQL that creates the endpoint for the API.
```
new yql(`select * from weather.forecast where woeid in (select woeid from geo.places(1) where text='${city.toLowerCase()}') and u='c'`);
```

#### Google Maps API ReverseGeocoding
---

[Google Maps API Reverse Geocoding](https://developers.google.com/maps/documentation/javascript/examples/geocoding-reverse) is used to return a readable location from given coordinates. The app uses this to get the users current location and returns the city they are currently in.

#### Events
---

* **Socket.io connection:** When a user has entered his name and a city and submits, a socket connection is made and makes an API call to the Yahoo Weather API server. This returns the weather data for this city and this user. Other users who already are logged in will get a notification of this user logging in and at the same time, the new user will get a notification of all other users already online.
* **On update:** The app updates the weather data for the users every hour and returns the new data to the users.

#### Database
---

The app doesn't yet have a database set up. However, it does keep a record of all the users who are online locally using a database array, `var database = [];`, and updates this database when new users log in or users log out.
