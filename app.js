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

  //table for interviews
  db.run(`CREATE TABLE IF NOT EXISTS interviews (
    id INTEGER PRIMARY KEY,
    application_id INTEGER UNIQUE,
    interview_date TEXT NOT NULL,
    interview_time TEXT NOT NULL,
    location TEXT NOT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (application_id) REFERENCES applications(id)
  )`);
  //table for candidate profiles
  db.run(`CREATE TABLE IF NOT EXISTS candidate_profiles (
    user_id INTEGER PRIMARY KEY,
    full_name TEXT,
    skills TEXT,
    education TEXT,
    experience TEXT,
    resume_path TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
  // In database for feedback
db.run(`CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL,
  comments TEXT NOT NULL,
  rating INTEGER CHECK(rating BETWEEN 1 AND 5),
  from_role TEXT CHECK(from_role IN ('candidate', 'recruiter')) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (application_id) REFERENCES applications(id)
)`);
});

// Middleware to check login
const requireLogin = (req, res, next) => {
  if (!req.session.userId) {
    req.session.errorMessage = 'Please log in to apply for a job';
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  next();
};

// Routes
app.get('/', (req, res) => {
  db.all('SELECT * FROM jobs', (err, jobs) => {
    if (err) throw err;
    res.render('index', { jobs , session: req.session});
  });
});

app.get('/register', (req, res) => {
  res.render('register',{session: req.session});
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
  const errorMessage = req.session.errorMessage || ''; // Get error message from session
  delete req.session.errorMessage; // Clear the error message from session
  res.render('login', { error: errorMessage ,session: req.session});
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

// Dashboard routes
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

            db.all(
              'SELECT * FROM interviews WHERE application_id IN (SELECT id FROM applications WHERE candidate_id = ?)',
              [req.session.userId],
              (err, interviews) => {
                if (err) throw err;

                // Fetch feedback for each application
                const feedbackPromises = applications.map(application => {
                  return new Promise((resolve, reject) => {
                    db.all(
                      'SELECT * FROM feedback WHERE application_id = ? AND from_role = "recruiter"',
                      [application.id],
                      (err, feedbacks) => {
                        if (err) reject(err);
                        resolve({ applicationId: application.id, feedbacks });
                      }
                    );
                  });
                });

                Promise.all(feedbackPromises)
                  .then(feedbackData => {
                    const feedbackMap = feedbackData.reduce((acc, { applicationId, feedbacks }) => {
                      acc[applicationId] = feedbacks;
                      return acc;
                    }, {});

                    res.render('dashboard', { applications, jobs, searchQuery, interviews, feedbackMap, session: req.session });
                  })
                  .catch(err => {
                    console.error(err);
                    res.send('Error loading feedback');
                  });
              }
            );
          }
        );
      }
    );
  });
});

// Apply for a job
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

  const searchQuery = req.query.q || '';
  const recruiterId = req.session.userId;

  db.serialize(() => {
    db.all(
      `SELECT jobs.*, COUNT(applications.id) AS application_count
      FROM jobs 
      LEFT JOIN applications ON jobs.id = applications.job_id
      WHERE jobs.recruiter_id = ? AND (jobs.title LIKE ? OR jobs.description LIKE ?)
      GROUP BY jobs.id`,
      [recruiterId, `%${searchQuery}%`, `%${searchQuery}%`],
      (err, jobs) => {
        if (err) throw err;
        res.render('recruiter-dashboard', { jobs, searchQuery, session: req.session });
      }
    );
  });
});

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
    if (err) throw err;

    // Fetch profiles and feedback for all applicants
    const applicantsWithProfilesAndFeedback = applicants.map(applicant => {
      return new Promise((resolve, reject) => {
        db.get(
          'SELECT * FROM candidate_profiles WHERE user_id = ?',
          [applicant.candidate_id],
          (err, profile) => {
            if (err) reject(err);
            db.all(
              'SELECT * FROM feedback WHERE application_id = ? AND from_role = "candidate"',
              [applicant.id],
              (err, feedbacks) => {
                if (err) reject(err);
                resolve({ ...applicant, profile, feedbacks });
              }
            );
          }
        );
      });
    });

    Promise.all(applicantsWithProfilesAndFeedback)
      .then(data => res.render('job-applicants', { applicants: data,session: req.session }))
      .catch(err => {
        console.error(err);
        res.send('Error loading applicants');
      });
  });
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

// Interview routes
app.post('/schedule-interview', requireLogin, (req, res) => {
  const { application_id, interview_date, interview_time, location, notes } = req.body;

  // Validate recruiter ownership
  db.get(
    `SELECT jobs.recruiter_id 
     FROM applications
     JOIN jobs ON applications.job_id = jobs.id
     WHERE applications.id = ?`,
    [application_id],
    (err, row) => {
      if (err || !row || row.recruiter_id !== req.session.userId) {
        return res.status(403).send('Unauthorized');
      }

      // Insert interview details
      db.run(
        `INSERT INTO interviews 
        (application_id, interview_date, interview_time, location, notes)
        VALUES (?, ?, ?, ?, ?)`,
        [application_id, interview_date, interview_time, location, notes],
        (err) => {
          if (err) return res.send('Error scheduling interview');
          res.redirect('back');
        }
      );
    }
  );
});

// View/Edit Profile
app.get('/profile', requireLogin, (req, res) => {
  db.get(
    'SELECT * FROM candidate_profiles WHERE user_id = ?',
    [req.session.userId],
    (err, profile) => {
      res.render('profile', { profile ,session: req.session});
    }
  );
});

// Save Profile
const multer = require('multer');
const upload = multer({ dest: 'public/resumes/' });

app.post('/profile', 
  requireLogin, 
  upload.single('resume'), 
  (req, res) => {
    const { full_name, skills, education, experience } = req.body;
    const resumePath = req.file ? `/resumes/${req.file.filename}` : null;

    db.run(
      `INSERT INTO candidate_profiles 
      (user_id, full_name, skills, education, experience, resume_path)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        full_name = excluded.full_name,
        skills = excluded.skills,
        education = excluded.education,
        experience = excluded.experience,
        resume_path = excluded.resume_path`,
      [req.session.userId, full_name, skills, education, experience, resumePath],
      (err) => {
        if (err) throw err;
        res.redirect('/profile');
      }
    );
  }
);
// Submit Feedback
app.post('/submit-feedback', requireLogin, (req, res) => {
  const { application_id, comments, rating } = req.body;
  const from_role = req.session.role; // candidate or recruiter

  // Validate application ownership
  const validationQuery = req.session.role === 'candidate' ? 
    'SELECT 1 FROM applications WHERE id = ? AND candidate_id = ?' :
    `SELECT 1 FROM applications 
     JOIN jobs ON applications.job_id = jobs.id 
     WHERE applications.id = ? AND jobs.recruiter_id = ?`;

  db.get(validationQuery, [application_id, req.session.userId], (err, valid) => {
    if (err || !valid) return res.status(403).send('Unauthorized');

    db.run(
      `INSERT INTO feedback 
      (application_id, comments, rating, from_role)
      VALUES (?, ?, ?, ?)`,
      [application_id, comments, rating, from_role],
      (err) => {
        if (err) return res.send('Error submitting feedback');
        res.redirect('back');
      }
    );
  });
});
