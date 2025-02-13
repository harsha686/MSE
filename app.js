const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const app = express();

// Database setup
const db = new sqlite3.Database('database.db');

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');

// Initialize tables (run once)
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      recruiter_id INTEGER,
      FOREIGN KEY (recruiter_id) REFERENCES users(id)
    )
  `);
});

// Routes (add below)
app.get('/', (req, res) => {
  db.all('SELECT * FROM jobs', (err, jobs) => {
    if (err) throw err;
    res.render('index', { jobs });
  });
});

// Start server
app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
// Registration route
app.get('/register', (req, res) => {
    res.render('register');
  });
  
  app.post('/register', (req, res) => {
    const { name, email, password, role } = req.body;
    db.run(
      'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
      [name, email, password, role],
      (err) => {
        if (err) {
          return res.send('Email already exists!');
        }
        res.redirect('/login');
      }
    );
  });
  const session = require('express-session');

// Add this after initializing `app`
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // Change to `true` if using HTTPS
}));

// Login Route
app.get('/login', (req, res) => {
  res.render('login');
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  db.get(
    'SELECT * FROM users WHERE email = ? AND password = ?',
    [email, password],
    (err, user) => {
      if (err || !user) {
        return res.send('Invalid email or password');
      }
      req.session.userId = user.id;
      req.session.role = user.role;
      res.redirect('/dashboard');
    }
  );
});
// Middleware to check if user is logged in
const requireLogin = (req, res, next) => {
    if (!req.session.userId) {
      return res.redirect('/login');
    }
    next();
  };
  app.get('/dashboard', requireLogin, (req, res) => {
    if (req.session.role === 'candidate') {
      // Fetch candidate's applications
      db.all(
        'SELECT * FROM applications WHERE candidate_id = ?',
        [req.session.userId],
        (err, applications) => {
          if (err) throw err;
          res.render('dashboard', { applications });
        }
      );
    } else {
      // Recruiter dashboard (add later)
      res.send('Recruiter dashboard');
    }
  });
  app.post('/login', (req, res) => {
    // ...
    db.get('SELECT * FROM users WHERE email = ? AND password = ?', [email, password], (err, user) => {
      if (err || !user) {
        return res.send('Invalid email or password');
      }
      // Proceed with session
    });
  });
  app.use(session({ /* ... */ }));
  app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
  });
  db.serialize(() => {
    // ... Existing tables ...
    db.run(`
      CREATE TABLE IF NOT EXISTS applications (
        id INTEGER PRIMARY KEY,
        candidate_id INTEGER,
        job_id INTEGER,
        status TEXT DEFAULT 'applied',
        FOREIGN KEY (candidate_id) REFERENCES users(id),
        FOREIGN KEY (job_id) REFERENCES jobs(id)
      )
    `);
  });
  app.post('/apply/:jobId', requireLogin, (req, res) => {
    const { jobId } = req.params;
    db.run(
      'INSERT INTO applications (candidate_id, job_id) VALUES (?, ?)',
      [req.session.userId, jobId],
      (err) => {
        if (err) throw err;
        res.redirect('/dashboard');
      }
    );
  });