const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const app = express();

// Database setup
const db = new sqlite3.Database('database.db');

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));

// Initialize tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    recruiter_id INTEGER,
    FOREIGN KEY (recruiter_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY,
    candidate_id INTEGER,
    job_id INTEGER,
    status TEXT DEFAULT 'applied',
    FOREIGN KEY (candidate_id) REFERENCES users(id),
    FOREIGN KEY (job_id) REFERENCES jobs(id)
  )`);
});

// Middleware to check login
const requireLogin = (req, res, next) => {
  if (!req.session.userId) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  next();
};

// Routes
app.get('/', (req, res) => {
  db.all('SELECT * FROM jobs', (err, jobs) => {
    if (err) throw err;
    res.render('index', { jobs });
  });
});

app.get('/register', (req, res) => {
  res.render('register');
});

app.post('/register', (req, res) => {
  const { name, email, password, role } = req.body;
  db.run(
    'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
    [name, email, password, role],
    (err) => {
      if (err) return res.send('Email already exists!');
      res.redirect('/login');
    }
  );
});

app.get('/login', (req, res) => {
  const error = req.query.error || '';
  res.render('login', { error });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  db.get(
    'SELECT * FROM users WHERE email = ? AND password = ?',
    [email, password],
    (err, user) => {
      if (err || !user) return res.send('Invalid credentials');
      
      req.session.userId = user.id;
      req.session.role = user.role;
      const redirectUrl = req.session.returnTo || '/dashboard';
      delete req.session.returnTo;
      res.redirect(redirectUrl);
    }
  );
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

app.get('/dashboard', requireLogin, (req, res) => {
  if (req.session.role === 'recruiter') {
    return res.redirect('/recruiter-dashboard');
  }

  const searchQuery = req.query.q || '';
  db.serialize(() => {
    db.all(
      'SELECT * FROM applications WHERE candidate_id = ?',
      [req.session.userId],
      (err, applications) => {
        if (err) throw err;

        db.all(
          `SELECT jobs.*, EXISTS(
            SELECT 1 FROM applications 
            WHERE applications.job_id = jobs.id 
            AND applications.candidate_id = ?
          ) AS has_applied
          FROM jobs WHERE title LIKE ? OR description LIKE ?`,
          [req.session.userId, `%${searchQuery}%`, `%${searchQuery}%`],
          (err, jobs) => {
            if (err) throw err;
            res.render('dashboard', { applications, jobs, searchQuery, session: req.session });
          }
        );
      }
    );
  });
});

app.post('/apply/:jobId', requireLogin, (req, res) => {
  if (req.session.role !== 'candidate') {
    return res.status(403).send('Only candidates can apply');
  }

  const jobId = req.params.jobId;
  const candidateId = req.session.userId;

  db.get(
    'SELECT * FROM applications WHERE candidate_id = ? AND job_id = ?',
    [candidateId, jobId],
    (err, existing) => {
      if (err) throw err;
      if (existing) return res.send('You already applied for this job');

      db.run(
        'INSERT INTO applications (candidate_id, job_id, status) VALUES (?, ?, ?)',
        [candidateId, jobId, 'applied'],
        (err) => {
          if (err) throw err;
          res.redirect('/dashboard');
        }
      );
    }
  );
});

// Recruiter routes
app.get('/recruiter-dashboard', requireLogin, (req, res) => {
  if (req.session.role !== 'recruiter') {
    return res.redirect('/dashboard');
  }

  db.all(
    `SELECT jobs.*, COUNT(applications.id) AS application_count
    FROM jobs LEFT JOIN applications ON jobs.id = applications.job_id
    WHERE jobs.recruiter_id = ?
    GROUP BY jobs.id`,
    [req.session.userId],
    (err, jobs) => {
      if (err) throw err;
      res.render('recruiter-dashboard', { jobs });
    }
  );
});

app.get('/job-applicants/:jobId', requireLogin, (req, res) => {
  const jobId = req.params.jobId;
  db.all(
    `SELECT applications.*, users.name AS candidate_name, users.email AS candidate_email
    FROM applications JOIN users ON applications.candidate_id = users.id
    WHERE job_id = ?`,
    [jobId],
    (err, applicants) => {
      if (err) throw err;
      res.render('job-applicants', { applicants });
    }
  );
});

app.post('/update-status/:appId', requireLogin, (req, res) => {
  const { appId } = req.params;
  const { status } = req.body;
  db.run(
    'UPDATE applications SET status = ? WHERE id = ?',
    [status, appId],
    (err) => {
      if (err) throw err;
      res.redirect('back');
    }
  );
});

app.post('/post-job', requireLogin, (req, res) => {
  const { title, description } = req.body;
  db.run(
    'INSERT INTO jobs (title, description, recruiter_id) VALUES (?, ?, ?)',
    [title, description, req.session.userId],
    (err) => {
      if (err) throw err;
      res.redirect('/recruiter-dashboard');
    }
  );
});

// Start server
app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
