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
      const searchQuery = req.query.q || ''; // Get search term from query string
  
      // Fetch candidate's applications
      db.all(
        'SELECT * FROM applications WHERE candidate_id = ?',
        [req.session.userId],
        (err, applications) => {
          if (err) throw err;
  
          // Fetch jobs with search filter
          db.all(
            `SELECT 
              jobs.*, 
              EXISTS(
                SELECT 1 FROM applications 
                WHERE applications.job_id = jobs.id 
                AND applications.candidate_id = ?
              ) AS has_applied
            FROM jobs
            WHERE title LIKE ? OR description LIKE ?`,
            [req.session.userId, `%${searchQuery}%`, `%${searchQuery}%`],
            (err, jobs) => {
              if (err) throw err;
              res.render('dashboard', { 
                applications,
                jobs,
                searchQuery, // Pass searchQuery to the template
                session: req.session
              });
            }
          );
        }
      );
    } else {
      res.redirect('/recruiter-dashboard');
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
  // Recruiter Dashboard Route
app.get('/recruiter-dashboard', requireLogin, (req, res) => {
  if (req.session.role !== 'recruiter') {
    return res.redirect('/dashboard');
  }

  // Fetch recruiter's posted jobs and applicant counts
  db.all(`
    SELECT 
      jobs.*, 
      COUNT(applications.id) AS application_count
    FROM jobs
    LEFT JOIN applications ON jobs.id = applications.job_id
    WHERE jobs.recruiter_id = ?
    GROUP BY jobs.id
  `, [req.session.userId], (err, jobs) => {
    if (err) throw err;
    res.render('recruiter-dashboard', { jobs });
  });
});

// View Applicants for a Job
// app.js
app.get('/job-applicants/:jobId', requireLogin, (req, res) => {
  const jobId = req.params.jobId;
  
  db.all(`
    SELECT 
      applications.*, 
      users.name AS candidate_name,
      users.email AS candidate_email
    FROM applications 
    JOIN users ON applications.candidate_id = users.id 
    WHERE job_id = ?
  `, [jobId], (err, applicants) => {
    if (err) {
      console.error("Error fetching applicants:", err); // Log errors
      return res.send("Error loading applicants");
    }
    // Inside the /job-applicants route
     console.log("Fetching applicants for job ID:", jobId);
     console.log("Applicants data:", applicants);
    res.render('job-applicants', { 
      applicants,
      session: req.session 
    });
  });
});

// Update Application Status
app.post('/update-status/:appId', requireLogin, (req, res) => {
  const { appId } = req.params;
  const { status } = req.body;

  db.run(
    'UPDATE applications SET status = ? WHERE id = ?',
    [status, appId],
    (err) => {
      if (err) throw err;
      res.redirect('back'); // Go back to previous page
    }
  );
});

// Post New Job
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
app.get('/dashboard', requireLogin, (req, res) => {
  if (req.session.role === 'candidate') {
    const searchQuery = req.query.q || ''; // Get search term

    // Fetch candidate's applications
    db.all(
      'SELECT * FROM applications WHERE candidate_id = ?',
      [req.session.userId],
      (err, applications) => {
        if (err) throw err;

        // Fetch jobs with search filter
        db.all(
          `SELECT 
            jobs.*, 
            EXISTS(
              SELECT 1 FROM applications 
              WHERE applications.job_id = jobs.id 
              AND applications.candidate_id = ?
            ) AS has_applied
          FROM jobs
          WHERE title LIKE ? OR description LIKE ?`,
          [req.session.userId, `%${searchQuery}%`, `%${searchQuery}%`],
          (err, jobs) => {
            if (err) throw err;
            res.render('dashboard', { 
              applications,
              jobs,
              searchQuery, // Pass this to template
              session: req.session
            });
          }
        );
      }
    );
  } else {
    res.redirect('/recruiter-dashboard');
  }
});
app.post('/apply/:jobId', requireLogin, (req, res) => {
  if (req.session.role !== 'candidate') {
    return res.status(403).send('Only candidates can apply');
  }

  const { jobId } = req.params;
  db.run(
    'INSERT INTO applications (candidate_id, job_id) VALUES (?, ?)',
    [req.session.userId, jobId],
    (err) => {
      if (err) {
        if (err.code === 'SQLITE_CONSTRAINT') {
          return res.send('You already applied for this job');
        }
        throw err;
      }
      res.redirect('/dashboard');
    }
  );
});
//apply route
app.post('/apply/:jobId', requireLogin, (req, res) => {
  if (req.session.role !== 'candidate') {
    return res.redirect('/login');
  }

  const jobId = req.params.jobId;
  const candidateId = req.session.userId;

  // Check if already applied
  db.get(
    'SELECT * FROM applications WHERE candidate_id = ? AND job_id = ?',
    [candidateId, jobId],
    (err, existingApplication) => {
      if (err) throw err;

      if (existingApplication) {
        return res.send('You have already applied for this job.');
      }

      // Insert new application
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
