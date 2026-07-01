const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const bcrypt = require("bcrypt");
const session = require("express-session");
const multer = require("multer");
const path = require("path");
const fs = require("fs");


const app = express();
const PORT = process.env.PORT || 5000;

app.use("/uploads", express.static(path.join(__dirname, "uploads")));


const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");


const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB per image
    files: 10
  }
});

// TEMPORARY TEST VALUES
const SPACES_KEY = "DO801XRL9F8AJ999F7Q6";
const SPACES_SECRET = "M+wct3lzuKVE9RZ+quJ/9d88xWgHgI4QBfU9Ei9FKP0";
const SPACES_BUCKET = "didwapa-images";
const SPACES_REGION = "fra1";

const spacesClient = new S3Client({
  endpoint: `https://${SPACES_REGION}.digitaloceanspaces.com`,
  region: SPACES_REGION,
  credentials: {
    accessKeyId: SPACES_KEY,
    secretAccessKey: SPACES_SECRET
  }
});

app.use(cors({
  origin: [
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://10.143.255.31:5000",
    "https://didwapa.com",
    "https://www.didwapa.com"
  ],
  credentials: true
}));

app.use(session({
  secret: "didwapa_secret_key",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    sameSite: "lax"
  }
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/uploads", express.static("uploads"));

const db = mysql.createConnection({
  host: "didwapa-db-do-user-28779964-0.l.db.ondigitalocean.com",
  port: 25060,
  user: "doadmin",
  password: "AVNS_degqR0I6013iI0PsQd5",
  database: "didwapadb",
  ssl: {
    rejectUnauthorized: false
  }
});

db.connect((err) => {
  if (err) {
    console.error("Database connection failed:", err);
    return;
  }

  console.log("Connected to DigitalOcean MySQL database: didwapadb");
});


// const db = mysql.createConnection({ 
//   host: "localhost", user: "root", 
//   password: "", 
//   database: "didwapadb" }); 
//   db.connect((err) => { if (err) 
//     { console.error("Database connection failed:", err); return; } 
//     console.log("Connected to MySQL database: didwapadb"); });

app.post("/api/create-account", async (req, res) => {
  try {
    const {
      firstname,
      lastname,
      email,
      gender,
      telephone,
      otherTelephone,
      role,
      pin,
      confirmPin
    } = req.body;

    if (
      !firstname ||
      !lastname ||
      !email ||
      !gender ||
      !telephone ||
      !role ||
      !pin ||
      !confirmPin
    ) {
      return res.status(400).json({
        ok: false,
        message: "Please fill all required fields."
      });
    }

    if (!["admin", "vendor", "user"].includes(role)) {
      return res.status(400).json({
        ok: false,
        message: "Invalid account type selected."
      });
    }

    if (!["Male", "Female"].includes(gender)) {
      return res.status(400).json({
        ok: false,
        message: "Invalid gender selected."
      });
    }

    if (!/^\d{6}$/.test(pin)) {
      return res.status(400).json({
        ok: false,
        message: "PIN must be exactly 6 digits."
      });
    }

    if (pin !== confirmPin) {
      return res.status(400).json({
        ok: false,
        message: "PIN and Confirm PIN do not match."
      });
    }

    db.query(
      "SELECT id FROM users WHERE email = ?",
      [email],
      async (emailErr, emailRows) => {
        if (emailErr) {
          console.error("Email check error:", emailErr);
          return res.status(500).json({
            ok: false,
            message: "Error checking email."
          });
        }

        if (emailRows.length > 0) {
          return res.status(400).json({
            ok: false,
            message: "Email already exists."
          });
        }

       try {
  const hashedPin = await bcrypt.hash(pin, 10);

  let accountStatus = "pending";

  if (role === "admin" || role === "user") {
    accountStatus = "approved";
  } else if (role === "vendor") {
    accountStatus = "pending";
  }

  const sql = `
    INSERT INTO users
    (firstname, lastname, email, gender, telephone, other_telephone, role, status, pin_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(
    sql,
    [
      firstname,
      lastname,
      email,
      gender,
      telephone,
      otherTelephone || null,
      role,
      accountStatus,
      hashedPin
    ],
            (insertErr, result) => {
              if (insertErr) {
                console.error("Insert error:", insertErr);
                return res.status(500).json({
                  ok: false,
                  message: "Failed to create account."
                });
              }

              return res.json({
                ok: true,
                message: "Account created successfully.",
                userId: result.insertId
              });
            }
          );
        } catch (hashErr) {
          console.error("Hash error:", hashErr);
          return res.status(500).json({
            ok: false,
            message: "Error securing PIN."
          });
        }
      }
    );
  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({
      ok: false,
      message: "Server error."
    });
  }
});


app.post("/api/dashboard/login", (req, res) => {
  try {
    const { email, pin } = req.body;

    if (!email || !pin) {
      return res.status(400).json({
        ok: false,
        success: false,
        message: "Email and PIN are required."
      });
    }

    const sql = `
      SELECT id, firstname, lastname, email, role, status, pin_hash
      FROM users
      WHERE email = ?
      LIMIT 1
    `;

    db.query(sql, [email], async (err, rows) => {
      if (err) {
        console.error("Dashboard login query error:", err);
        return res.status(500).json({
          ok: false,
          success: false,
          message: "Server error during login."
        });
      }

      if (rows.length === 0) {
        return res.status(400).json({
          ok: false,
          success: false,
          message: "Invalid email or PIN."
        });
      }

      const user = rows[0];

      if (user.role !== "admin" && user.role !== "vendor") {
        return res.status(403).json({
          ok: false,
          success: false,
          message: "Access denied. Only admin and vendor can login here."
        });
      }

      if (user.status !== "approved") {
        return res.status(403).json({
          ok: false,
          success: false,
          message: "Your account is not approved yet."
        });
      }

      const pinMatch = await bcrypt.compare(pin, user.pin_hash);

      if (!pinMatch) {
        return res.status(400).json({
          ok: false,
          success: false,
          message: "Invalid email or PIN."
        });
      }

      req.session.user = {
        id: user.id,
        firstname: user.firstname,
        lastname: user.lastname,
        email: user.email,
        role: user.role,
        status: user.status
      };

      req.session.save(() => {
        return res.json({
          ok: true,
          success: true,
          message: "Login successful.",
          user: {
            id: user.id,
            firstname: user.firstname,
            lastname: user.lastname,
            email: user.email,
            role: user.role,
            status: user.status
          }
        });
      });
    });

  } catch (error) {
    console.error("Dashboard login error:", error);
    return res.status(500).json({
      ok: false,
      success: false,
      message: "Server error."
    });
  }
});


app.get("/api/dashboard/me", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Not logged in."
    });
  }

  res.json({
    success: true,
    user: req.session.user
  });
});


///// Admin Detals update 
// GET LOGGED-IN ADMIN OR VENDOR PROFILE
app.get("/api/admin/profile", (req, res) => {

  if (
    !req.session.user ||
    !["admin", "vendor"].includes(req.session.user.role)
  ) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized. Please login first."
    });
  }

  const userId = req.session.user.id;

  const sql = `
    SELECT 
      id,
      firstname,
      lastname,
      email,
      gender,
      telephone,
      other_telephone,
      role,
      status,
      created_at
    FROM users
    WHERE id = ?
    LIMIT 1
  `;

  db.query(sql, [userId], (err, result) => {

    if (err) {
      console.log(err);

      return res.status(500).json({
        success: false,
        message: "Database error"
      });
    }

    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    res.json({
      success: true,
      user: result[0]
    });

  });

});


// UPDATE ADMIN PROFILE
app.put("/api/admin/profile/update", (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(401).json({
      success: false,
      message: "Unauthorized. Please login as admin."
    });
  }

  const adminId = req.session.user.id;

  const {
    firstname,
    lastname,
    email,
    gender,
    telephone,
    other_telephone
  } = req.body;



  const sql = `
    UPDATE users
    SET firstname = ?, lastname = ?, email = ?, gender = ?, telephone = ?, other_telephone = ?
    WHERE id = ? AND role = 'admin'
  `;

  db.query(
    sql,
    [firstname, lastname, email, gender, telephone, other_telephone || null, adminId],
    (err) => {
      if (err) {
        console.log(err);
        return res.status(500).json({
          success: false,
          message: "Failed to update profile"
        });
      }

      res.json({
        success: true,
        message: "Profile updated successfully"
      });
    }
  );
});


// CHANGE ADMIN PASSWORD
app.put("/api/admin/profile/change-password", async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(401).json({
      success: false,
      message: "Unauthorized. Please login as admin."
    });
  }

  const adminId = req.session.user.id;
  const { current_password, new_password, confirm_password } = req.body;

  if (!current_password || !new_password || !confirm_password) {
    return res.status(400).json({
      success: false,
      message: "All password fields are required."
    });
  }

  if (new_password !== confirm_password) {
    return res.status(400).json({
      success: false,
      message: "New password and confirm password do not match."
    });
  }

  if (new_password.length < 6) {
    return res.status(400).json({
      success: false,
      message: "Password must be at least 6 characters."
    });
  }

  db.query(
    "SELECT pin_hash FROM users WHERE id = ? AND role = 'admin'",
    [adminId],
    async (err, result) => {
      if (err) {
        console.log(err);
        return res.status(500).json({
          success: false,
          message: "Database error"
        });
      }

      if (result.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Admin not found"
        });
      }

      const savedHash = result[0].pin_hash;
      const isMatch = await bcrypt.compare(current_password, savedHash);

      if (!isMatch) {
        return res.status(400).json({
          success: false,
          message: "Current password is incorrect."
        });
      }

      const newHash = await bcrypt.hash(new_password, 10);

      db.query(
        "UPDATE users SET pin_hash = ? WHERE id = ? AND role = 'admin'",
        [newHash, adminId],
        (updateErr) => {
          if (updateErr) {
            console.log(updateErr);
            return res.status(500).json({
              success: false,
              message: "Failed to change password"
            });
          }

          res.json({
            success: true,
            message: "Password changed successfully"
          });
        }
      );
    }
  );
});



///// Logout safe 
app.get("/api/vendor/check-session", (req, res) => {
  if (!req.session.user || req.session.user.role !== "vendor") {
    return res.json({
      loggedIn: false
    });
  }

  res.json({
    loggedIn: true,
    user: req.session.user
  });
});


///// Verify 
// app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// const storage = multer.diskStorage({
//   destination: function (req, file, cb) {
//     cb(null, "uploads/");
//   },
//   filename: function (req, file, cb) {
//     const uniqueName = Date.now() + "-" + file.originalname.replace(/\s+/g, "_");
//     cb(null, uniqueName);
//   }
// });

// const upload = multer({
//   storage,
//   limits: {
//     fieldSize: 10 * 1024 * 1024,
//     fileSize: 10 * 1024 * 1024
//   }
// });






app.get("/api/vendor/verification-details", (req, res) => {
  if (!req.session.user || req.session.user.role !== "vendor") {
    return res.status(401).json({
      success: false,
      message: "Unauthorized. Please login as vendor."
    });
  }

  const vendorId = req.session.user.id;

  const sql = `
    SELECT 
      verification_other_tel,
      digital_address,
      address,
      alt_number,
      alt_number_name
    FROM users
    WHERE id = ? AND role = 'vendor'
  `;

  db.query(sql, [vendorId], (err, results) => {
    if (err) {
      console.error("Fetch verification details error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load saved details."
      });
    }

    res.json({
      success: true,
      data: results[0] || {}
    });
  });
});


app.post("/api/vendor/verify-step-one", (req, res) => {
  if (!req.session.user || req.session.user.role !== "vendor") {
    return res.status(401).json({
      success: false,
      message: "Unauthorized. Please login as vendor."
    });
  }

  const vendorId = req.session.user.id;

 const {
  verification_other_tel,
  digital_address,
  address,
  alt_number,
  alt_number_name
} = req.body || {};

  if (
    !verification_other_tel ||
    !digital_address ||
    !address ||
    !alt_number ||
    !alt_number_name
  ) {
    return res.status(400).json({
      success: false,
      message: "All Step 1 fields are required."
    });
  }

  const sql = `
    UPDATE users
    SET verification_other_tel = ?,
        digital_address = ?,
        address = ?,
        alt_number = ?,
        alt_number_name = ?
    WHERE id = ? AND role = 'vendor'
  `;

  db.query(
    sql,
    [
      verification_other_tel,
      digital_address,
      address,
      alt_number,
      alt_number_name,
      vendorId
    ],
    (err) => {
      if (err) {
        console.error("Step one verification error:", err);
        return res.status(500).json({
          success: false,
          message: "Failed to save details."
        });
      }

      res.json({
        success: true,
        message: "Details saved successfully."
      });
    }
  );
});


app.post(
  "/api/vendor/verify-account",
  upload.fields([
    { name: "selfie_image", maxCount: 1 },
    { name: "gh_card_front", maxCount: 1 },
    { name: "gh_card_back", maxCount: 1 }
  ]),
  (req, res) => {
    if (!req.session.user || req.session.user.role !== "vendor") {
      return res.status(401).json({
        success: false,
        message: "Unauthorized. Please login as vendor."
      });
    }

    const vendorId = req.session.user.id;

    if (
      !req.files.selfie_image ||
      !req.files.gh_card_front ||
      !req.files.gh_card_back
    ) {
      return res.status(400).json({
        success: false,
        message: "Selfie, Ghana Card front and back pictures are required."
      });
    }

    const selfie = req.files.selfie_image[0].filename;
    const front = req.files.gh_card_front[0].filename;
    const back = req.files.gh_card_back[0].filename;

    const sql = `
      UPDATE users
      SET selfie_image = ?,
          gh_card_front = ?,
          gh_card_back = ?,
          verification_status = 'pending'
      WHERE id = ? AND role = 'vendor'
    `;

 db.query(sql, [selfie, front, back, vendorId], (err, result) => {
  if (err) {
    console.error("Vendor verification image error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to submit verification."
    });
  }

  if (result.affectedRows === 0) {
    return res.status(404).json({
      success: false,
      message: "Vendor account not found or role is not vendor."
    });
  }

  return res.json({
    success: true,
    message: "Verification submitted successfully. Please wait for admin approval."
  });
});
  }
);



app.get("/api/vendor/profile", (req, res) => {
  if (!req.session.user || req.session.user.role !== "vendor") {
    return res.status(401).json({
      success: false,
      message: "Unauthorized. Please login as vendor."
    });
  }

  const vendorId = req.session.user.id;

  const sql = `
    SELECT 
      id,
      firstname,
      lastname,
      email,
      gender,
      telephone,
      other_telephone,
      role,
      status,
      verification_other_tel,
      digital_address,
      address,
      alt_number,
      alt_number_name,
      selfie_image,
      gh_card_front,
      gh_card_back,
      verification_status,
      created_at
    FROM users
    WHERE id = ? AND role = 'vendor'
  `;

  db.query(sql, [vendorId], (err, results) => {
    if (err) {
      console.error("Vendor profile error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load profile."
      });
    }

    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found."
      });
    }

    res.json({
      success: true,
      user: results[0]
    });
  });
});








///// Admin fetch users
// GET ALL USERS FOR ADMIN
app.get("/api/admin/users", (req, res) => {
  if (
  !req.session.user ||
  !["admin", "vendor"].includes(req.session.user.role)
) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const sql = `
    SELECT id, firstname, lastname, role, status, verification_status
    FROM users
    ORDER BY id DESC
  `;

  db.query(sql, (err, rows) => {
    if (err) {
      console.error("Fetch users error:", err);
      return res.status(500).json({ success: false, message: "Failed to fetch users" });
    }

    res.json({ success: true, users: rows });
  });
});


// GET SINGLE USER
app.get("/api/admin/users/:id", (req, res) => {
  if (
  !req.session.user ||
  !["admin", "vendor"].includes(req.session.user.role)
) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const { id } = req.params;

  db.query("SELECT * FROM users WHERE id = ?", [id], (err, rows) => {
    if (err) {
      console.error("View user error:", err);
      return res.status(500).json({ success: false, message: "Failed to fetch user" });
    }

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.json({ success: true, user: rows[0] });
  });
});


// APPROVE USER
app.put("/api/admin/users/:id/approve", (req, res) => {
  if (
  !req.session.user ||
  !["admin", "vendor"].includes(req.session.user.role)
) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  db.query(
   "UPDATE users SET status = 'approved' WHERE id = ?",
    [req.params.id],
    (err) => {
      if (err) {
        console.error("Approve user error:", err);
        return res.status(500).json({ success: false, message: "Failed to approve user" });
      }

      res.json({ success: true, message: "User approved successfully" });
    }
  );
});


// SET USER PENDING
app.put("/api/admin/users/:id/pending", (req, res) => {
  if (
  !req.session.user ||
  !["admin", "vendor"].includes(req.session.user.role)
) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  db.query(
   "UPDATE users SET status = 'pending' WHERE id = ?",
    [req.params.id],
    (err) => {
      if (err) {
        console.error("Pending user error:", err);
        return res.status(500).json({ success: false, message: "Failed to update user" });
      }

      res.json({ success: true, message: "User set to pending" });
    }
  );
});


// DELETE USER
app.delete("/api/admin/users/:id", (req, res) => {
  if (
  !req.session.user ||
  !["admin", "vendor"].includes(req.session.user.role)
) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  db.query("DELETE FROM users WHERE id = ?", [req.params.id], (err) => {
    if (err) {
      console.error("Delete user error:", err);
      return res.status(500).json({ success: false, message: "Failed to delete user" });
    }

    res.json({ success: true, message: "User deleted successfully" });
  });
});

///// Check login Session 
app.get("/api/admin/check-session", (req, res) => {

  if (
    !req.session.user ||
    !["admin", "vendor"].includes(req.session.user.role)
  ) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized"
    });
  }

  res.json({
    success: true,
    user: req.session.user
  });

});



app.post("/api/user/create-account", upload.none(), async (req, res) => {
  try {
    const {
      firstname,
      lastname,
      gender,
      dob,
      digital_address,
      address,
      telephone,
      other_telephone,
      email,
      password,
      confirm_password
    } = req.body;

    if (
      !firstname || !lastname || !gender || !dob ||
      !digital_address || !address || !telephone ||
      !email || !password || !confirm_password
    ) {
      return res.status(400).json({
        success: false,
        message: "Please fill all required fields."
      });
    }

    if (password !== confirm_password) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match."
      });
    }

    const checkSql = `
      SELECT id FROM users 
      WHERE email = ? OR telephone = ?
      LIMIT 1
    `;

    db.query(checkSql, [email, telephone], async (checkErr, existingUser) => {
      if (checkErr) {
        console.error("Check user error:", checkErr);
        return res.status(500).json({
          success: false,
          message: "Database error while checking account."
        });
      }

      if (existingUser.length > 0) {
        return res.status(409).json({
          success: false,
          message: "Email or telephone number already exists."
        });
      }

      const pinHash = await bcrypt.hash(password, 10);

      const sql = `
        INSERT INTO users 
        (
          firstname,
          lastname,
          gender,
          dob,
          digital_address,
          address,
          telephone,
          other_telephone,
          email,
          pin_hash,
          role,
          status,
          verification_status,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `;

      db.query(
        sql,
        [
          firstname,
          lastname,
          gender,
          dob,
          digital_address,
          address,
          telephone,
          other_telephone || null,
          email,
          pinHash,
          "user",
          "pending",
          "pending"
        ],
        (err) => {
          if (err) {
            console.error("Create user error:", err);
            return res.status(500).json({
              success: false,
              message: "Database error while creating account."
            });
          }

          res.json({
            success: true,
            message: "Account created successfully. Please wait for approval."
          });
        }
      );
    });

  } catch (error) {
    console.error("Create account error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while creating account."
    });
  }
});





///// User Login 
app.post("/api/user/login", (req, res) => {
  const { login, password } = req.body;

  if (!login || !password) {
    return res.status(400).json({
      success: false,
      message: "Email/phone and password are required."
    });
  }

  const sql = `
    SELECT id, firstname, lastname, email, telephone, role, status, pin_hash
    FROM users
    WHERE email = ? OR telephone = ?
    LIMIT 1
  `;

  db.query(sql, [login, login], async (err, results) => {

    if (err) {
      console.error("Login error:", err);

      return res.status(500).json({
        success: false,
        message: "Server error. Please try again."
      });
    }

    if (results.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid email/phone or password."
      });
    }

    const user = results[0];

    const passwordMatch = await bcrypt.compare(password, user.pin_hash);

    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email/phone or password."
      });
    }

    req.session.user = {
      id: user.id,
      firstname: user.firstname,
      lastname: user.lastname,
      email: user.email,
      telephone: user.telephone,
      role: user.role,
      status: user.status
    };

    req.session.save((saveErr) => {

      if (saveErr) {
        console.error("SESSION SAVE ERROR:", saveErr);

        return res.status(500).json({
          success: false,
          message: "Failed to save login session."
        });
      }

      console.log("USER SESSION SAVED:", req.session.user);

      return res.json({
        success: true,
        message: "Login successful.",
        userId: user.id,
        role: user.role,
        status: user.status,
        user: req.session.user
      });

    });

  });
});
///// Admin post products 


const productUploadPath = path.join(__dirname, "uploads/products");

if (!fs.existsSync(productUploadPath)) {
  fs.mkdirSync(productUploadPath, { recursive: true });
}

const productStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, productUploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueName =
      Date.now() + "-" + Math.round(Math.random() * 1e9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const uploadProductImages = multer({
  storage: productStorage,
  limits: {
    files: 10
  }
});

app.use("/uploads/products", express.static(path.join(__dirname, "uploads/products")));

app.post("/api/admin/post-product", uploadProductImages.array("product_images", 10), (req, res) => {
  try {
    console.log("SESSION USER:", req.session.user);
    console.log("BODY:", req.body);
    console.log("FILES:", req.files?.length);

    if (!req.session.user) {
      return res.status(401).json({
        success: false,
        message: "Session expired. Please login again."
      });
    }

    const posted_by = req.session.user.id;
    const status = "approved";

    const {
      category,
      product_name,
      product_type,
      price,
      product_color,
      quantity_in_stock,
      instructions,
      item_condition
    } = req.body;

    if (
      !category ||
      !product_name ||
      !product_type ||
      !price ||
      quantity_in_stock === undefined ||
      quantity_in_stock === ""
    ) {
      return res.status(400).json({
        success: false,
        message: "Please fill all required fields."
      });
    }

    if (!req.files || req.files.length < 5) {
      return res.status(400).json({
        success: false,
        message: "Please upload at least 5 product pictures."
      });
    }

    const userSql = "SELECT id, telephone FROM users WHERE id = ?";

    db.query(userSql, [posted_by], (userErr, userResult) => {
      if (userErr) {
        console.error("USER CHECK ERROR:", userErr);
        return res.status(500).json({
          success: false,
          message: userErr.sqlMessage || "Database error while checking logged-in user."
        });
      }

      if (userResult.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Logged-in user not found."
        });
      }

      const phoneNumber = userResult[0].telephone;
      const imagePaths = req.files.map(file => `/uploads/products/${file.filename}`);

      const insertSql = `
        INSERT INTO products 
        (
          category,
          product_name,
          product_type,
          price,
          product_color,
          quantity_in_stock,
          status,
          phone_number,
          instructions,
          item_condition,
          images,
          posted_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      db.query(
        insertSql,
        [
          category,
          product_name,
          product_type,
          price,
          product_color || null,
          quantity_in_stock,
          status,
          phoneNumber,
          instructions || null,
          item_condition || null,
          JSON.stringify(imagePaths),
          posted_by
        ],
        (insertErr) => {
          if (insertErr) {
            console.error("PRODUCT INSERT ERROR:", insertErr);
            return res.status(500).json({
              success: false,
              message: insertErr.sqlMessage || "Failed to post product."
            });
          }

          res.json({
            success: true,
            message: "Product posted successfully."
          });
        }
      );
    });

  } catch (error) {
    console.error("SERVER ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Server error."
    });
  }
});



// ===============================
// ADMIN: GET ALL PRODUCT POSTS
// ===============================
app.get("/api/admin/products", (req, res) => {
  const sql = `
    SELECT 
      products.*,
      users.firstname,
      users.lastname,
      users.email,
      users.telephone
    FROM products
    LEFT JOIN users ON products.posted_by = users.id
    ORDER BY products.id DESC
  `;

  db.query(sql, (err, results) => {
    if (err) {
      console.error("Fetch admin products error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch products"
      });
    }

    res.json({
      success: true,
      products: results
    });
  });
});

// ===============================
// ADMIN: GET SINGLE PRODUCT DETAILS
// ===============================
app.get("/api/admin/products/:id", (req, res) => {
  const productId = req.params.id;

  const sql = `
    SELECT 
      products.*,
      users.firstname,
      users.lastname,
      users.email,
      users.telephone
    FROM products
    LEFT JOIN users ON products.posted_by = users.id
    WHERE products.id = ?
  `;

  db.query(sql, [productId], (err, results) => {
    if (err) {
      console.error("Fetch product details error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch product details"
      });
    }

    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Product not found"
      });
    }

    res.json({
      success: true,
      product: results[0]
    });
  });
});


// ===============================
// ADMIN: UPDATE PRODUCT STATUS
// ===============================
app.put("/api/admin/products/:id/status", (req, res) => {
  const productId = req.params.id;
  const { status } = req.body;

  const allowedStatuses = ["pending", "approved", "under review", "denied"];

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      message: "Invalid product status"
    });
  }

  const sql = `
    UPDATE products 
    SET status = ?
    WHERE id = ?
  `;

  db.query(sql, [status, productId], (err, result) => {
    if (err) {
      console.error("Update product status error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to update product status"
      });
    }

    res.json({
      success: true,
      message: `Product marked as ${status}`
    });
  });
});




///// Index Display
app.get("/api/products", (req, res) => {
 const { category, subcategory, search, region, district, brand } = req.query;

  const categoryAliases = {
    "Phones & Tablets": [
      "Phones & Tablets",
      "Phones and Accessories",
      "Phones & Accessories"
    ],
    "Electronics": ["Electronics"],
    "Fashion": ["Fashion"],
    "Home Appliances": ["Home Appliances"],
    "Services": ["Services"]
  };

  const subcategoryAliases = {
    "Mobile Phones": ["Mobile Phones", "Mobile Phone", "Phone", "Phones"],
    "Tablets": ["Tablets", "Tablet"],

    "Laptops & Computers": [
      "Laptops & Computers",
      "Laptop",
      "Laptops",
      "Computers",
      "Desktop Computer"
    ],
    "Headphones": ["Headphones", "Headphone", "Earphones", "Earbuds"],
    "Smart Watchs": ["Smart Watchs", "Smart Watches", "Smart Watch"],
    "Video Game Consoles": [
      "Video Game Consoles",
      "Gaming Consoles",
      "Game Consoles",
      "Game Controllers",
      "Console",
      "Controller"
    ],

    "Men's Clothing": ["Men's Clothing", "Mens Clothing", "Men Clothing"],
    "Women's Clothing": ["Women's Clothing", "Womens Clothing", "Women Clothing"],
    "Shoes": ["Shoes", "Shoe"],
    "Bags": ["Bags", "Bag"],
    "Wigs & Hair Extensions": ["Wigs & Hair Extensions", "Wigs", "Hair Extensions"],
    "Watches": ["Watches", "Watch"],
    "Jewelry": ["Jewelry", "Jewellery"],
    "Perfume": ["Perfume", "Perfumes"],
    "Beauty Accessories": ["Beauty Accessories"],

    "TVs": ["TVs", "TV", "Television", "Televisions"],
    "Fridge": ["Fridge", "Fridges", "Refrigerator", "Refrigerators"],
    "Fans": ["Fans", "Fan"],
    "Air Conditioners": ["Air Conditioners", "Air Conditioner", "AC"],

    "Graphic Design": ["Graphic Design"],
    "Website Design": ["Website Design", "Web Design"],
    "Plumbing": ["Plumbing", "Plumber"],
    "Electricians": ["Electricians", "Electrician"],
    "Cleaning Services": ["Cleaning Services", "Cleaning"]
  };

  let sql = `
    SELECT 
      id,
      region,
      district,
      product_name,
      category,
      subcategory,
      product_type,
      
      price,
      product_color,
      quantity_in_stock,
      status,
      phone_number,
      instructions,
      item_condition,
      images,
      specifications,
      posted_by
    FROM products
    WHERE status = 'approved'
  `;

  const values = [];

  function addLikeGroup(fields, words) {
    const conditions = [];

    words.forEach(word => {
      fields.forEach(field => {
        conditions.push(`LOWER(${field}) LIKE LOWER(?)`);
        values.push(`%${word.trim()}%`);
      });
    });

    sql += ` AND (${conditions.join(" OR ")})`;
  }

  if (category && category !== "All") {
    const cats = categoryAliases[category] || [category];

    addLikeGroup(
      ["category"],
      cats
    );
  }

  if (subcategory && subcategory.trim() !== "") {
    const subs = subcategoryAliases[subcategory] || [subcategory];

    addLikeGroup(
      ["subcategory", "product_type", "product_name"],
      subs
    );
  }

if (brand && brand.trim() !== "") {
  sql += `
    AND LOWER(
      JSON_UNQUOTE(
        JSON_EXTRACT(specifications, '$.brand')
      )
    ) = LOWER(?)
  `;
  values.push(brand.trim());
}

  if (search && search.trim() !== "") {
    addLikeGroup(
      ["product_name", "subcategory", "product_type", "category"],
      [search]
    );
  }

  if (region && region !== "All Ghana") {
    sql += ` AND LOWER(region) = LOWER(?)`;
    values.push(region.trim());
  }

  if (district && district.trim() !== "" && district !== "All Districts") {
    sql += ` AND LOWER(district) = LOWER(?)`;
    values.push(district.trim());
  }

  sql += ` ORDER BY id DESC`;

  console.log("========== PRODUCT SEARCH ==========");
  console.log("Category:", category);
  console.log("Subcategory:", subcategory);
  console.log("Search:", search);
  console.log("Brand:", brand);
  console.log("Region:", region);
  console.log("District:", district);
  console.log("SQL:", sql);
  console.log("VALUES:", values);
  console.log("====================================");

  db.query(sql, values, (err, results) => {
    if (err) {
      console.error("Fetch products error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load products"
      });
    }

    console.log("Products found:", results.length);

    res.json({
      success: true,
      products: results
    });
  });
});


////// Saved unposted products 
app.post("/api/products/drafts/save", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Please login first."
    });
  }

  const userId = req.session.user.id;
  const draftData = JSON.stringify(req.body || {});

  const sql = `
    INSERT INTO product_drafts (user_id, draft_data)
    VALUES (?, ?)
  `;

  db.query(sql, [userId, draftData], (err, result) => {
    if (err) {
      console.error("Save draft error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to save draft."
      });
    }

    res.json({
      success: true,
      message: "Draft saved successfully.",
      draftId: result.insertId
    });
  });
});


app.get("/api/products/drafts", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Please login first."
    });
  }

  const userId = req.session.user.id;

  const sql = `
    SELECT id, draft_data, created_at, updated_at
    FROM product_drafts
    WHERE user_id = ?
    ORDER BY updated_at DESC
  `;

  db.query(sql, [userId], (err, results) => {
    if (err) {
      console.error("Load drafts error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load drafts."
      });
    }

    res.json({
      success: true,
      drafts: results
    });
  });
});


app.get("/api/products/drafts/:id", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Please login first."
    });
  }

  const userId = req.session.user.id;
  const draftId = req.params.id;

  const sql = `
    SELECT id, draft_data
    FROM product_drafts
    WHERE id = ? AND user_id = ?
    LIMIT 1
  `;

  db.query(sql, [draftId, userId], (err, results) => {
    if (err) {
      console.error("Load draft error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load draft."
      });
    }

    if (!results.length) {
      return res.status(404).json({
        success: false,
        message: "Draft not found."
      });
    }

    res.json({
      success: true,
      draft: results[0]
    });
  });
});


app.delete("/api/products/drafts/:id", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Please login first."
    });
  }

  const userId = req.session.user.id;
  const draftId = req.params.id;

  db.query(
    "DELETE FROM product_drafts WHERE id = ? AND user_id = ?",
    [draftId, userId],
    (err) => {
      if (err) {
        console.error("Delete draft error:", err);
        return res.status(500).json({
          success: false,
          message: "Failed to delete draft."
        });
      }

      res.json({
        success: true,
        message: "Draft deleted."
      });
    }
  );
});


app.get("/api/products/:id", (req, res) => {
  const productId = req.params.id;

  const sql = `
    SELECT 
      id,
      category,
      subcategory,
      region,
      district,
      product_name,
      product_type,
      price,
      product_color,
      quantity_in_stock,
      status,
      phone_number,
      instructions,
      description,
      item_condition,
      images,
      specifications,
      seller_name,
      youtube_link,
      registered_car,
      exchange_possible,
      negotiable,
      bulk_min_qty,
      bulk_price,
      delivery_available,
      delivery_fee_type,
      delivery_time,
      pickup_available,
      promotion_type,
      posted_by,
      created_at
    FROM products
    WHERE id = ? 
      AND status = 'approved'
    LIMIT 1
  `;

  db.query(sql, [productId], (err, results) => {
    if (err) {
      console.error("Fetch product details error:", err);
      return res.status(500).json({
        success: false,
        message: err.sqlMessage || "Failed to load product details"
      });
    }

    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Product not found"
      });
    }

    res.json({
      success: true,
      product: results[0]
    });
  });
});



app.get("/api/check-user-login", (req, res) => {
  console.log("SESSION USER:", req.session.user);

  if (req.session && req.session.user) {
    return res.json({
      loggedIn: true,
      user: req.session.user
    });
  }

  return res.json({
    loggedIn: false
  });
});




app.get("/api/user/notifications", (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Please login first."
    });
  }

  const sql = `
    SELECT id, title, message, created_at
    FROM admin_notifications
    WHERE status = 'active'
    ORDER BY created_at DESC
  `;

  db.query(sql, (err, results) => {
    if (err) {
      console.error("Notifications error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load notifications."
      });
    }

    res.json({
      success: true,
      notifications: results
    });
  });
});
app.get("/api/user/profile", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Please login first."
    });
  }

  const userId = req.session.user.id;

  const sql = `
    SELECT 
      id,
      firstname,
      lastname,
      email,
      gender,
      dob,
      telephone,
      other_telephone,
      role,
      status,
      digital_address,
      address,
      verification_status,
      selfie_image,
      gh_card_front,
      gh_card_back,

      business_name,
      business_type,
      business_category,
      business_description,
      business_whatsapp,
      business_email,
      business_address,
      business_region,
      business_district,
      business_logo,
      business_registration_number,
      business_registration_cert,
      business_tin,
      business_website,
      business_hours,
      delivery_available,
      delivery_coverage,

      created_at
    FROM users
    WHERE id = ?
    LIMIT 1
  `;

  db.query(sql, [userId], (err, results) => {
    if (err) {
      console.error("User profile error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load profile."
      });
    }

    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found."
      });
    }

    res.json({
      success: true,
      user: results[0]
    });
  });
});
app.put(
  "/api/user/profile/update",
  upload.fields([
    { name: "gh_card_front", maxCount: 1 },
    { name: "gh_card_back", maxCount: 1 },
    { name: "selfie_image", maxCount: 1 },
    { name: "business_logo", maxCount: 1 },
    { name: "business_registration_cert", maxCount: 1 }
  ]),
  async (req, res) => {
    if (!req.session.user) {
      return res.status(401).json({
        success: false,
        message: "Please login first."
      });
    }

    const userId = req.session.user.id;

    const {
      firstname,
      lastname,
      email,
      telephone,
      other_telephone,
      gender,
      dob,
      digital_address,
      address,

      business_name,
business_type,
business_category,
business_description,
business_whatsapp,
business_email,
business_address,
business_region,
business_district,
business_logo,
business_registration_number,
business_registration_cert,
business_tin,
business_website,
business_hours,
delivery_available,
delivery_coverage,
    } = req.body;

    if (!firstname || !lastname || !email || !telephone) {
      return res.status(400).json({
        success: false,
        message: "Firstname, lastname, email and telephone are required."
      });
    }

    try {
      function getFileUrl(file, folder) {
        return new Promise(async (resolve, reject) => {
          if (!file) return resolve(null);

          try {
            const ext = path.extname(file.originalname);
            const key = `users/${folder}/${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;

            await spacesClient.send(
              new PutObjectCommand({
                Bucket: SPACES_BUCKET,
                Key: key,
                Body: file.buffer,
                ACL: "public-read",
                ContentType: file.mimetype
              })
            );

            resolve(`https://${SPACES_BUCKET}.${SPACES_REGION}.digitaloceanspaces.com/${key}`);
          } catch (err) {
            reject(err);
          }
        });
      }

      const ghCardFrontUrl = await getFileUrl(req.files?.gh_card_front?.[0], "ghana-cards");
      const ghCardBackUrl = await getFileUrl(req.files?.gh_card_back?.[0], "ghana-cards");
      const selfieUrl = await getFileUrl(req.files?.selfie_image?.[0], "selfies");
      const businessLogoUrl = await getFileUrl(req.files?.business_logo?.[0], "business-logos");
      const businessCertUrl = await getFileUrl(req.files?.business_registration_cert?.[0], "business-certificates");

      const sql = `
        UPDATE users
        SET 
          firstname = ?,
          lastname = ?,
          email = ?,
          telephone = ?,
          other_telephone = ?,
          gender = ?,
          dob = ?,
          digital_address = ?,
          address = ?,

          gh_card_front = COALESCE(?, gh_card_front),
          gh_card_back = COALESCE(?, gh_card_back),
          selfie_image = COALESCE(?, selfie_image),

          business_name = ?,
          business_type = ?,
          business_category = ?,
          business_description = ?,
          business_whatsapp = ?,
          business_email = ?,
          business_address = ?,
          business_region = ?,
          business_district = ?,
          business_logo = COALESCE(?, business_logo),
          business_registration_number = ?,
          business_registration_cert = COALESCE(?, business_registration_cert),
          business_tin = ?,
          business_website = ?,
          business_hours = ?,
          delivery_available = ?,
          delivery_coverage = ?,

          verification_status = 'pending',
          status = 'pending'
        WHERE id = ?
      `;

      db.query(
        sql,
        [
          firstname,
          lastname,
          email,
          telephone,
          other_telephone || null,
          gender || null,
          dob || null,
          digital_address || null,
          address || null,

          ghCardFrontUrl,
          ghCardBackUrl,
          selfieUrl,

          business_name || null,
          business_type || null,
          business_category || null,
          business_description || null,
          business_whatsapp || null,
          business_email || null,
          business_address || null,
          business_region || null,
          business_district || null,
          businessLogoUrl,
          business_registration_number || null,
          businessCertUrl,
          business_tin || null,
          business_website || null,
          business_hours || null,
          delivery_available || null,
          delivery_coverage || null,

          userId
        ],
        (err) => {
          if (err) {
            console.error("Update user profile error:", err);
            return res.status(500).json({
              success: false,
              message: err.sqlMessage || "Failed to update profile."
            });
          }

        req.session.user.firstname = firstname || req.session.user.firstname;
req.session.user.lastname = lastname || req.session.user.lastname;
req.session.user.email = email || req.session.user.email;
req.session.user.telephone = telephone || req.session.user.telephone;

          req.session.save(() => {
            res.json({
              success: true,
              message: "Profile submitted successfully. Please wait for approval."
            });
          });
        }
      );
    } catch (error) {
      console.error("Profile upload error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to upload profile files."
      });
    }
  }
);


app.put("/api/user/profile/change-password", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Please login first."
    });
  }

  const userId = req.session.user.id;

  const {
    current_password,
    new_password,
    confirm_password
  } = req.body;

  if (!current_password || !new_password || !confirm_password) {
    return res.status(400).json({
      success: false,
      message: "All password fields are required."
    });
  }

  if (new_password !== confirm_password) {
    return res.status(400).json({
      success: false,
      message: "New password and confirm password do not match."
    });
  }

  if (new_password.length < 6) {
    return res.status(400).json({
      success: false,
      message: "Password must be at least 6 characters."
    });
  }

  db.query(
    "SELECT pin_hash FROM users WHERE id = ? LIMIT 1",
    [userId],
    async (err, results) => {
      if (err) {
        console.error("Password fetch error:", err);
        return res.status(500).json({
          success: false,
          message: "Database error."
        });
      }

      if (results.length === 0) {
        return res.status(404).json({
          success: false,
          message: "User not found."
        });
      }

      const match = await bcrypt.compare(current_password, results[0].pin_hash);

      if (!match) {
        return res.status(400).json({
          success: false,
          message: "Current password is incorrect."
        });
      }

      const newHash = await bcrypt.hash(new_password, 10);

      db.query(
        "UPDATE users SET pin_hash = ? WHERE id = ?",
        [newHash, userId],
        (updateErr) => {
          if (updateErr) {
            console.error("Password update error:", updateErr);
            return res.status(500).json({
              success: false,
              message: "Failed to change password."
            });
          }

          res.json({
            success: true,
            message: "Password changed successfully."
          });
        }
      );
    }
  );
});



///// Users Add Products 
app.post(
  "/api/products/upload",
  upload.array("images", 10),

  async (req, res) => {
    const requestId = Date.now();

    console.log(`\n========== PRODUCT UPLOAD START ${requestId} ==========`);

    try {
      console.log("SESSION USER:", req.session.user || "NO SESSION USER");

      if (!req.session.user) {
        console.log("FAILED: User not logged in");
        return res.status(401).json({
          success: false,
          message: "Please login first."
        });
      }

      const userId = req.session.user.id;
      console.log("USER ID:", userId);


      const statusSql = `
  SELECT status
  FROM users
  WHERE id = ?
  LIMIT 1
`;

const [userStatus] = await new Promise((resolve, reject) => {
  db.query(statusSql, [userId], (err, results) => {
    if (err) return reject(err);
    resolve(results);
  });
});

if (!userStatus) {
  return res.status(404).json({
    success: false,
    message: "User account not found."
  });
}

if (String(userStatus.status).toLowerCase() !== "approved") {
  return res.status(403).json({
    success: false,
    message: "Your account is not approved yet. Please complete your account and wait for DIDWAPA approval before posting."
  });
}

      console.log("BODY RECEIVED:", req.body);
      console.log("FILES RECEIVED:", req.files ? req.files.length : 0);

      const {
        category,
        subcategory,
        region,
        district,
        product_name,
        product_type,
        price,
        product_color,
        quantity_in_stock,
        phone_number,
        instructions,
        description,
        item_condition,
        specifications,
        seller_name,
        youtube_link,
        registered_car,
        exchange_possible,
        negotiable,
        bulk_min_qty,
        bulk_price,
        delivery_available,
        delivery_fee_type,
        delivery_time,
        pickup_available,
        promotion_type
      } = req.body;

      console.log("REQUIRED FIELD CHECK:", {
        category,
        subcategory,
        region,
        district,
        product_name,
        product_type,
        price,
        phone_number,
        item_condition
      });

      if (
        !category ||
        !subcategory ||
        !region ||
        !district ||
        !product_name ||
        !product_type ||
        !price ||
        !phone_number ||
        !item_condition
      ) {
        console.log("FAILED: Missing required fields");
        return res.status(400).json({
          success: false,
          message: "Please fill all required fields."
        });
      }

      if (!req.files || req.files.length < 5) {
        console.log("FAILED: Less than 5 images uploaded");
        return res.status(400).json({
          success: false,
          message: "Please upload at least 5 images."
        });
      }

      const imagePaths = [];

      console.log("STARTING SPACES IMAGE UPLOAD...");

      for (const file of req.files) {
        console.log("UPLOADING FILE:", {
          originalname: file.originalname,
          mimetype: file.mimetype,
          size: file.size
        });

        const ext = path.extname(file.originalname);
        const fileName = `products/${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;

        await spacesClient.send(
          new PutObjectCommand({
            Bucket: SPACES_BUCKET,
            Key: fileName,
            Body: file.buffer,
            ACL: "public-read",
            ContentType: file.mimetype
          })
        );

        const imageUrl = `https://${SPACES_BUCKET}.${SPACES_REGION}.digitaloceanspaces.com/${fileName}`;
        imagePaths.push(imageUrl);

        console.log("FILE UPLOADED:", imageUrl);
      }

      console.log("ALL IMAGE PATHS:", imagePaths);

      let cleanSpecs = null;

      try {
        cleanSpecs = specifications ? JSON.stringify(JSON.parse(specifications)) : JSON.stringify({});
        console.log("CLEAN SPECS:", cleanSpecs);
      } catch (e) {
        console.log("SPECIFICATIONS JSON PARSE ERROR:", e.message);
        console.log("RAW SPECIFICATIONS:", specifications);
        cleanSpecs = JSON.stringify({});
      }

      const sql = `
        INSERT INTO products (
          category,
          subcategory,
          region,
          district,
          product_name,
          product_type,
          price,
          product_color,
          quantity_in_stock,
          status,
          phone_number,
          instructions,
          description,
          item_condition,
          specifications,
          seller_name,
          youtube_link,
          registered_car,
          exchange_possible,
          negotiable,
          bulk_min_qty,
          bulk_price,
          delivery_available,
          delivery_fee_type,
          delivery_time,
          pickup_available,
          promotion_type,
          images,
          posted_by
        )
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `;

      const values = [
        category,
        subcategory,
        region,
        district,
        product_name,
        product_type,
        price,
        product_color || null,
        quantity_in_stock || 1,
        "pending",
        phone_number,
        instructions || null,
        description || null,
        item_condition,
        cleanSpecs,
        seller_name || null,
        youtube_link || null,
        registered_car || null,
        exchange_possible || null,
        negotiable || "Not sure",
        bulk_min_qty || null,
        bulk_price || null,
        delivery_available || null,
        delivery_fee_type || null,
        delivery_time || null,
        pickup_available || null,
        promotion_type || "No promo - Free",
        JSON.stringify(imagePaths),
        userId
      ];

      console.log("SQL TO RUN:", sql);
      console.log("VALUES TO INSERT:", values);

      db.query(sql, values, (err, result) => {
        if (err) {
          console.error("UPLOAD PRODUCT DB ERROR:", {
            message: err.message,
            sqlMessage: err.sqlMessage,
            code: err.code,
            errno: err.errno,
            sqlState: err.sqlState
          });

          console.log(`========== PRODUCT UPLOAD FAILED ${requestId} ==========\n`);

          return res.status(500).json({
            success: false,
            message: err.sqlMessage || "Failed to upload product."
          });
        }

        console.log("INSERT RESULT:", result);
        console.log("INSERTED PRODUCT ID:", result.insertId);
        console.log(`========== PRODUCT UPLOAD SUCCESS ${requestId} ==========\n`);

        res.json({
          success: true,
          message: "Product uploaded successfully and pending approval.",
          productId: result.insertId
        });
      });

    } catch (error) {
      console.error("PRODUCT UPLOAD CATCH ERROR:", {
        message: error.message,
        stack: error.stack
      });

      console.log(`========== PRODUCT UPLOAD CRASHED ${requestId} ==========\n`);

      res.status(500).json({
        success: false,
        message: "Failed to upload images. Please try again."
      });
    }
  }
);




/////User Products view 
app.get(
"/api/user/my-products",
(req,res)=>{

if(!req.session.user){

return res.json({
success:false
});

}

const userId =
req.session.user.id;

db.query(
`
SELECT *
FROM products
WHERE posted_by = ?
ORDER BY id DESC
`,
[userId],

(err,results)=>{

if(err){

return res.json({
success:false
});

}

res.json({
success:true,
products:results
});

});

});



app.get(
"/api/user/product/:id",
(req,res)=>{

if(!req.session.user){

return res.json({
success:false
});

}

const productId =
req.params.id;

const userId =
req.session.user.id;

db.query(
`
SELECT *
FROM products
WHERE id = ?
AND posted_by = ?
`,
[productId,userId],

(err,results)=>{

if(err || results.length===0){

return res.json({
success:false
});

}

res.json({
success:true,
product:results[0]
});

});

});



app.delete(
"/api/user/delete-product/:id",
(req,res)=>{

if(!req.session.user){

return res.json({
success:false,
message:"Unauthorized"
});

}

const productId =
req.params.id;

const userId =
req.session.user.id;

db.query(
`
DELETE FROM products
WHERE id = ?
AND posted_by = ?
`,
[productId,userId],

(err)=>{

if(err){

return res.json({
success:false,
message:"Delete failed"
});

}

res.json({
success:true
});

});

});



///// Admin Delete Product 
app.delete("/api/admin/products/:id", (req, res) => {
  const productId = req.params.id;

  db.query(
    "DELETE FROM products WHERE id = ?",
    [productId],
    (err, result) => {
      if (err) {
        console.error("Delete product error:", err);
        return res.status(500).json({
          success: false,
          message: "Failed to delete product."
        });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: "Product not found."
        });
      }

      res.json({
        success: true,
        message: "Product deleted successfully."
      });
    }
  );
});


/////Cart Display 
app.post("/api/cart/add", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Please login first."
    });
  }

  const userId = req.session.user.id;
  const { product_id } = req.body;

  if (!product_id) {
    return res.status(400).json({
      success: false,
      message: "Product ID is required."
    });
  }

  const checkSql = `
    SELECT id, quantity 
    FROM carts 
    WHERE user_id = ? AND product_id = ? AND status = 'active'
    LIMIT 1
  `;

  db.query(checkSql, [userId, product_id], (err, rows) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: "Cart check failed."
      });
    }

    if (rows.length > 0) {
      const updateSql = `
        UPDATE carts 
        SET quantity = quantity + 1 
        WHERE id = ?
      `;

      return db.query(updateSql, [rows[0].id], (updateErr) => {
        if (updateErr) {
          return res.status(500).json({
            success: false,
            message: "Failed to save product."
          });
        }

        res.json({
          success: true,
          message: "Product quantity updated in save."
        });
      });
    }

    const insertSql = `
      INSERT INTO carts (user_id, product_id, quantity)
      VALUES (?, ?, 1)
    `;

    db.query(insertSql, [userId, product_id], (insertErr) => {
      if (insertErr) {
        return res.status(500).json({
          success: false,
          message: "Product failed to save"
        });
      }

      res.json({
        success: true,
        message: "Product saved"
      });
    });
  });
});


app.get("/api/cart/my-cart", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Please login first."
    });
  }

  const userId = req.session.user.id;

  const sql = `
    SELECT 
      carts.id AS cart_id,
      carts.quantity,
      carts.created_at,
      products.id AS product_id,
      products.product_name,
      products.price,
      products.product_color,
      products.quantity_in_stock,
      products.images,
      products.item_condition,
      products.phone_number
    FROM carts
    JOIN products ON carts.product_id = products.id
    WHERE carts.user_id = ? AND carts.status = 'active'
    ORDER BY carts.id DESC
  `;

  db.query(sql, [userId], (err, results) => {
    if (err) {
      console.error("Cart fetch error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load cart."
      });
    }

    res.json({
      success: true,
      cart: results
    });
  });
});


app.delete("/api/cart/remove/:id", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Please login first."
    });
  }

  const userId = req.session.user.id;
  const cartId = req.params.id;

  db.query(
    "DELETE FROM carts WHERE id = ? AND user_id = ?",
    [cartId, userId],
    (err) => {
      if (err) {
        return res.status(500).json({
          success: false,
          message: "Failed to remove item."
        });
      }

      res.json({
        success: true,
        message: "Item removed from cart."
      });
    }
  );
});




///// Buy routes 
app.get("/api/products/:id/check-stock", (req, res) => {
  const productId = req.params.id;

  db.query(
    "SELECT id, quantity_in_stock FROM products WHERE id = ? LIMIT 1",
    [productId],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ success: false, message: "Stock check failed." });
      }

      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: "Product not found." });
      }

      const stock = Number(rows[0].quantity_in_stock);

      res.json({
        success: true,
        inStock: stock > 0,
        stock
      });
    }
  );
});



app.post("/api/purchase/complete", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Please login first."
    });
  }

  const buyerId = req.session.user.id;
  const buyerName = `${req.session.user.firstname || ""} ${req.session.user.lastname || ""}`.trim();
  const buyerPhone = req.session.user.telephone || "";

  const { product_id, quantity } = req.body;

  if (!product_id || !quantity || Number(quantity) <= 0) {
    return res.status(400).json({
      success: false,
      message: "Invalid purchase details."
    });
  }

  db.query("SELECT * FROM products WHERE id = ? LIMIT 1", [product_id], (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, message: "Failed to load product." });
    }

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Product not found." });
    }

    const product = rows[0];
    const qty = Number(quantity);
    const stock = Number(product.quantity_in_stock);
    const unitPrice = Number(product.price);
    const totalAmount = unitPrice * qty;
    const sellerId = product.posted_by;

    if (stock <= 0) {
      return res.status(400).json({ success: false, message: "This product is out of stock." });
    }

    if (qty > stock) {
      return res.status(400).json({
        success: false,
        message: `Only ${stock} item(s) available in stock.`
      });
    }

    db.beginTransaction((txErr) => {
      if (txErr) {
        return res.status(500).json({ success: false, message: "Transaction failed." });
      }

      const insertPurchaseSql = `
        INSERT INTO purchased_products
        (
          product_id, buyer_id, seller_id, buyer_name, buyer_phone,
          product_name, quantity, unit_price, total_amount,
          payment_status, order_status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', 'pending')
      `;

      db.query(
        insertPurchaseSql,
        [
          product.id,
          buyerId,
          sellerId,
          buyerName,
          buyerPhone,
          product.product_name,
          qty,
          unitPrice,
          totalAmount
        ],
        (insertErr, purchaseResult) => {
          if (insertErr) {
            return db.rollback(() => {
              res.status(500).json({ success: false, message: "Failed to save purchase." });
            });
          }

          const purchaseId = purchaseResult.insertId;

          const insertAdminSql = `
  INSERT INTO admin_sales_records
  (
    purchase_id,
    product_id,
    seller_id,
    buyer_id,
    product_name,
    quantity,
    unit_price,
    total_amount,
    balance_amount,
    payment_status
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid')
`;

          db.query(
            insertAdminSql,
            [
  purchaseId,
  product.id,
  sellerId,
  buyerId,
  product.product_name,
  qty,
  unitPrice,
  totalAmount,
  totalAmount
],
            (adminErr) => {
              if (adminErr) {
                return db.rollback(() => {
                  res.status(500).json({
                    success: false,
                    message: "Failed to save admin sales record."
                  });
                });
              }

              db.query(
                "UPDATE admin_account SET balance = balance + ? WHERE id = 1",
                [totalAmount],
                (adminAccountErr) => {
                  if (adminAccountErr) {
                    return db.rollback(() => {
                      res.status(500).json({
                        success: false,
                        message: "Failed to update admin account."
                      });
                    });
                  }

                  db.query(
                    "UPDATE products SET quantity_in_stock = quantity_in_stock - ? WHERE id = ?",
                    [qty, product.id],
                    (updateErr) => {
                      if (updateErr) {
                        return db.rollback(() => {
                          res.status(500).json({
                            success: false,
                            message: "Failed to update stock."
                          });
                        });
                      }

                      db.commit((commitErr) => {
                        if (commitErr) {
                          return db.rollback(() => {
                            res.status(500).json({
                              success: false,
                              message: "Failed to complete purchase."
                            });
                          });
                        }

                        res.json({
                          success: true,
                          message: "Payment successful. Product purchased successfully."
                        });
                      });
                    }
                  );
                }
              );
            }
          );
        }
      );
    });
  });
});



///// purchased products view 
app.get("/api/user/purchased-products", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Please login first."
    });
  }

  const sellerId = req.session.user.id;

  const sql = `
    SELECT 
      pp.*,
      p.images,
      p.product_color,
      p.item_condition,
      p.instructions,
      p.description
    FROM purchased_products pp
    LEFT JOIN products p ON pp.product_id = p.id
    WHERE pp.seller_id = ?
    ORDER BY pp.id DESC
  `;

  db.query(sql, [sellerId], (err, results) => {
    if (err) {
      console.error("Seller purchased products error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load purchased products."
      });
    }

    res.json({
      success: true,
      products: results
    });
  });
});

app.get("/api/user/purchased-products/:id", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Please login first."
    });
  }

  const userId = req.session.user.id;
  const purchaseId = req.params.id;

  const sql = `
    SELECT 
      pp.*,
      p.images,
      p.product_color,
      p.item_condition,
      p.instructions,
      p.description,
      p.phone_number
    FROM purchased_products pp
    LEFT JOIN products p ON pp.product_id = p.id
   WHERE pp.id = ? AND pp.seller_id = ?
    LIMIT 1
  `;

  db.query(sql, [purchaseId, userId], (err, results) => {
    if (err) {
      console.error("Purchased detail error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load details."
      });
    }

    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Purchase not found."
      });
    }

    res.json({
      success: true,
      purchase: results[0]
    });
  });
});

app.put("/api/user/purchased-products/:id/status", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Please login first."
    });
  }

  const sellerId = req.session.user.id;
  const purchaseId = req.params.id;
  const { order_status } = req.body;

  const allowed = ["delivering", "delivered", "not available"];

  if (!allowed.includes(order_status)) {
    return res.status(400).json({
      success: false,
      message: "Invalid status."
    });
  }

  const sql = `
    UPDATE purchased_products
    SET order_status = ?
    WHERE id = ? AND seller_id = ?
  `;

  db.query(sql, [order_status, purchaseId, sellerId], (err, result) => {
    if (err) {
      console.error("Update purchase status error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to update status."
      });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Purchase not found."
      });
    }

    res.json({
      success: true,
      message: "Order status updated successfully."
    });
  });
});



///// Report a problem route 
app.get("/api/report/messages", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Please login first."
    });
  }

  const userId = req.session.user.id;

  db.query(
    `
      SELECT *
      FROM report_messages
      WHERE user_id = ?
      ORDER BY id ASC
    `,
    [userId],
    (err, results) => {
      if (err) {
        return res.status(500).json({
          success: false,
          message: "Failed to load messages."
        });
      }

      res.json({
        success: true,
        messages: results
      });
    }
  );
});


app.post("/api/report/send", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Please login first."
    });
  }

  const userId = req.session.user.id;
  const { message } = req.body;

  if (!message || message.trim() === "") {
    return res.status(400).json({
      success: false,
      message: "Message is required."
    });
  }

  db.query(
    `
      INSERT INTO report_messages
      (user_id, sender, message)
      VALUES (?, 'user', ?)
    `,
    [userId, message.trim()],
    (err) => {
      if (err) {
        return res.status(500).json({
          success: false,
          message: "Failed to send message."
        });
      }

      res.json({
        success: true,
        message: "Message sent successfully."
      });
    }
  );
});




/////Admin reply message route 
app.get("/api/admin/report-users", (req, res) => {
  if (
    !req.session.user ||
    !["admin", "vendor"].includes(req.session.user.role)
  ) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized"
    });
  }

  const sql = `
    SELECT 
      rm.user_id,
      u.firstname,
      u.lastname,
      u.email,
      u.telephone,

      COUNT(rm.id) AS total_messages,

      SUM(
        CASE 
          WHEN rm.sender = 'user'
           AND rm.read_status = 'unread'
          THEN 1
          ELSE 0
        END
      ) AS unread_count,

      MAX(rm.created_at) AS last_message_time

    FROM report_messages rm
    LEFT JOIN users u ON rm.user_id = u.id

    GROUP BY 
      rm.user_id,
      u.firstname,
      u.lastname,
      u.email,
      u.telephone

    ORDER BY last_message_time DESC
  `;

  db.query(sql, (err, results) => {
    if (err) {
      console.error("Admin report users error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load report users."
      });
    }

    res.json({
      success: true,
      users: results
    });
  });
});


app.get("/api/admin/report-messages/:userId", (req, res) => {
  if (
    !req.session.user ||
    !["admin", "vendor"].includes(req.session.user.role)
  ) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized"
    });
  }

  db.query(
    `
      SELECT *
      FROM report_messages
      WHERE user_id = ?
      ORDER BY id ASC
    `,
    [req.params.userId],
    (err, results) => {
      if (err) {
        console.error("Admin report messages error:", err);
        return res.status(500).json({
          success: false,
          message: "Failed to load messages."
        });
      }

      res.json({
        success: true,
        messages: results
      });
    }
  );
});

app.post("/api/admin/report-reply", (req, res) => {
  if (
  !req.session.user ||
  !["admin", "vendor"].includes(req.session.user.role)
) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized"
    });
  }

  const { user_id, message } = req.body;

  if (!user_id || !message || message.trim() === "") {
    return res.status(400).json({
      success: false,
      message: "User and message are required."
    });
  }

  db.query(
    `
      INSERT INTO report_messages
      (user_id, sender, message)
      VALUES (?, 'admin', ?)
    `,
    [user_id, message.trim()],
    (err) => {
      if (err) {
        return res.status(500).json({
          success: false,
          message: "Failed to send reply."
        });
      }

      res.json({
        success: true,
        message: "Reply sent successfully."
      });
    }
  );
});




///// Approve upon receipt 
app.get("/api/buyer/purchases", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "Please login first." });
  }

  const buyerId = req.session.user.id;

  const sql = `
    SELECT 
      pp.*,
      p.images,
      p.product_color,
      p.item_condition,
      p.description,
      p.instructions
    FROM purchased_products pp
    LEFT JOIN products p ON pp.product_id = p.id
    WHERE pp.buyer_id = ?
    ORDER BY pp.id DESC
  `;

  db.query(sql, [buyerId], (err, results) => {
    if (err) {
      console.error("Buyer purchases error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load your purchases."
      });
    }

    res.json({ success: true, purchases: results });
  });
});


app.put("/api/buyer/purchases/:id/confirm-status", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "Please login first." });
  }

  const buyerId = req.session.user.id;
  const purchaseId = req.params.id;
  const { buyer_confirm_status, buyer_note } = req.body;

  const allowed = ["waiting", "received", "delayed", "not received"];

  if (!allowed.includes(buyer_confirm_status)) {
    return res.status(400).json({
      success: false,
      message: "Invalid confirmation status."
    });
  }

  const sql = `
    UPDATE purchased_products
    SET buyer_confirm_status = ?, buyer_note = ?
    WHERE id = ? AND buyer_id = ?
  `;

  db.query(
    sql,
    [buyer_confirm_status, buyer_note || null, purchaseId, buyerId],
    (err, result) => {
      if (err) {
        console.error("Buyer confirm update error:", err);
        return res.status(500).json({
          success: false,
          message: "Failed to update confirmation."
        });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: "Purchase not found."
        });
      }

      res.json({
        success: true,
        message: "Purchase confirmation updated successfully."
      });
    }
  );
});




///// Admin view Products 
app.get("/api/admin/orders", (req, res) => {
  if (
  !req.session.user ||
  !["admin", "vendor"].includes(req.session.user.role)
) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized"
    });
  }

  const sql = `
    SELECT 
      pp.*,
      p.images,
      p.product_color,
      p.item_condition,
      u.firstname AS buyer_firstname,
      u.lastname AS buyer_lastname,
      u.email AS buyer_email,
      u.telephone AS buyer_telephone
    FROM purchased_products pp
    LEFT JOIN products p ON pp.product_id = p.id
    LEFT JOIN users u ON pp.buyer_id = u.id
    ORDER BY pp.id DESC
  `;

  db.query(sql, (err, results) => {
    if (err) {
      console.error("Admin orders error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load orders."
      });
    }

    res.json({
      success: true,
      orders: results
    });
  });
});




app.get("/api/product-message/conversation/:productId", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "Please login first." });
  }

  const currentUserId = req.session.user.id;
  const productId = req.params.productId;
  const otherIdFromQuery = req.query.other_id;

  db.query("SELECT * FROM products WHERE id = ? LIMIT 1", [productId], (err, productRows) => {
    if (err || productRows.length === 0) {
      return res.status(404).json({ success: false, message: "Product not found." });
    }

    const product = productRows[0];
    const ownerId = product.posted_by;

    if (Number(currentUserId) !== Number(ownerId)) {
      const otherUserId = ownerId;
      return loadConversation(product, currentUserId, otherUserId, res);
    }

    if (otherIdFromQuery) {
      return loadConversation(product, currentUserId, otherIdFromQuery, res);
    }

    const findOtherSql = `
      SELECT 
        CASE 
          WHEN sender_id = ? THEN receiver_id 
          ELSE sender_id 
        END AS other_user_id
      FROM product_messages
      WHERE product_id = ?
      AND (sender_id = ? OR receiver_id = ?)
      ORDER BY id DESC
      LIMIT 1
    `;

    db.query(findOtherSql, [currentUserId, productId, currentUserId, currentUserId], (findErr, found) => {
      if (findErr || found.length === 0) {
        return res.json({
          success: true,
          product,
          otherUser: null,
          messages: []
        });
      }

      loadConversation(product, currentUserId, found[0].other_user_id, res);
    });
  });
});

function loadConversation(product, currentUserId, otherUserId, res) {
  const sql = `
    SELECT pm.*, 
      s.firstname AS sender_firstname,
      s.lastname AS sender_lastname,
      r.firstname AS receiver_firstname,
      r.lastname AS receiver_lastname
    FROM product_messages pm
    LEFT JOIN users s ON pm.sender_id = s.id
    LEFT JOIN users r ON pm.receiver_id = r.id
    WHERE pm.product_id = ?
    AND (
      (pm.sender_id = ? AND pm.receiver_id = ?)
      OR
      (pm.sender_id = ? AND pm.receiver_id = ?)
    )
    ORDER BY pm.id ASC
  `;

  db.query(
    sql,
    [product.id, currentUserId, otherUserId, otherUserId, currentUserId],
    (err, messages) => {
      if (err) {
        console.error("Conversation error:", err);
        return res.status(500).json({ success: false, message: "Failed to load messages." });
      }

      db.query(
        "SELECT id, firstname, lastname, email, telephone FROM users WHERE id = ? LIMIT 1",
        [otherUserId],
        (userErr, userRows) => {
          if (userErr) {
            return res.status(500).json({ success: false, message: "Failed to load user." });
          }

          res.json({
            success: true,
            product,
            otherUser: userRows[0] || null,
            messages
          });
        }
      );
    }
  );
}


app.post("/api/products/:id/price-offer", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Please login first."
    });
  }

  const buyerId = req.session.user.id;
  const productId = req.params.id;
  const { suggested_amount, message } = req.body;

  if (!suggested_amount || Number(suggested_amount) <= 0) {
    return res.status(400).json({
      success: false,
      message: "Enter a valid suggested amount."
    });
  }

  const findProductSql = `
    SELECT id, product_name, price, posted_by
    FROM products
    WHERE id = ?
    LIMIT 1
  `;

  db.query(findProductSql, [productId], (err, rows) => {
    if (err) {
      console.error("Find product for offer error:", err);
      return res.status(500).json({
        success: false,
        message: "Server error."
      });
    }

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Product not found."
      });
    }

    const product = rows[0];
    const sellerId = product.posted_by;

    if (Number(buyerId) === Number(sellerId)) {
      return res.status(400).json({
        success: false,
        message: "You cannot suggest price on your own product."
      });
    }

    const offerMessage =
      `💰 Price Suggestion\n` +
      `Product: ${product.product_name}\n` +
      `Original Price: GH₵${Number(product.price).toFixed(2)}\n` +
      `Suggested Price: GH₵${Number(suggested_amount).toFixed(2)}` +
      `${message ? `\nMessage: ${message}` : ""}`;

    const insertSql = `
      INSERT INTO product_messages
      (product_id, sender_id, receiver_id, message, status, read_status)
      VALUES (?, ?, ?, ?, 'sent', 'unread')
    `;

    db.query(
      insertSql,
      [productId, buyerId, sellerId, offerMessage],
      (insertErr) => {
        if (insertErr) {
          console.error("Insert price suggestion message error:", insertErr);
          return res.status(500).json({
            success: false,
            message: insertErr.sqlMessage || "Failed to send price suggestion."
          });
        }

        res.json({
          success: true,
          message: "Price suggestion sent to seller."
        });
      }
    );
  });
});


app.post("/api/product-message/send", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "Please login first." });
  }

  const senderId = req.session.user.id;
  const { product_id, receiver_id, message } = req.body;

  if (!product_id || !message || message.trim() === "") {
    return res.status(400).json({
      success: false,
      message: "Product and message are required."
    });
  }

  db.query("SELECT posted_by FROM products WHERE id = ? LIMIT 1", [product_id], (err, rows) => {
    if (err || rows.length === 0) {
      return res.status(404).json({ success: false, message: "Product not found." });
    }

    const productOwnerId = rows[0].posted_by;
    let finalReceiverId = receiver_id;

    if (!finalReceiverId) {
      finalReceiverId = productOwnerId;
    }

    if (Number(finalReceiverId) === Number(senderId)) {
      return res.status(400).json({
        success: false,
        message: "You cannot send a message to yourself."
      });
    }

    const sql = `
      INSERT INTO product_messages
      (product_id, sender_id, receiver_id, message)
      VALUES (?, ?, ?, ?)
    `;

    db.query(sql, [product_id, senderId, finalReceiverId, message.trim()], (insertErr) => {
      if (insertErr) {
        console.error("Product message error:", insertErr);
        return res.status(500).json({
          success: false,
          message: "Failed to send message."
        });
      }

      res.json({
        success: true,
        message: "Message sent successfully."
      });
    });
  });
});



app.get("/api/product-message/inbox", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Please login first."
    });
  }

  const userId = req.session.user.id;

  const sql = `
    SELECT 
      pm.product_id,
      p.product_name,
      p.images,

      CASE 
        WHEN pm.sender_id = ? THEN pm.receiver_id
        ELSE pm.sender_id
      END AS other_user_id,

      u.firstname,
      u.lastname,
      u.telephone,

      MAX(pm.created_at) AS last_message_time,
      COUNT(pm.id) AS total_messages,

      SUM(
        CASE 
          WHEN pm.receiver_id = ?
           AND pm.read_status = 'unread'
          THEN 1 
          ELSE 0 
        END
      ) AS unread_messages

    FROM product_messages pm

    LEFT JOIN products p ON pm.product_id = p.id

    LEFT JOIN users u ON u.id = CASE 
      WHEN pm.sender_id = ? THEN pm.receiver_id
      ELSE pm.sender_id
    END

    WHERE pm.sender_id = ? OR pm.receiver_id = ?

    GROUP BY 
      pm.product_id,
      other_user_id,
      p.product_name,
      p.images,
      u.firstname,
      u.lastname,
      u.telephone

    ORDER BY last_message_time DESC
  `;

  db.query(sql, [userId, userId, userId, userId, userId], (err, results) => {
    if (err) {
      console.error("Product inbox error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load inbox."
      });
    }

    res.json({
      success: true,
      inbox: results
    });
  });
});

app.get("/api/user/wallet", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Please login first."
    });
  }

  const userId = req.session.user.id;

  const walletSql = `
    SELECT balance 
    FROM user_wallets 
    WHERE user_id = ?
    LIMIT 1
  `;

  db.query(walletSql, [userId], (err, walletRows) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: "Failed to load wallet."
      });
    }

    if (walletRows.length === 0) {
      db.query(
        "INSERT INTO user_wallets (user_id, balance) VALUES (?, 0.00)",
        [userId],
        (insertErr) => {
          if (insertErr) {
            return res.status(500).json({
              success: false,
              message: "Failed to create wallet."
            });
          }

          return res.json({
            success: true,
            balance: 0.00,
            transactions: []
          });
        }
      );

      return;
    }

    db.query(
      `
        SELECT *
        FROM wallet_transactions
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT 20
      `,
      [userId],
      (txErr, txRows) => {
        if (txErr) {
          return res.status(500).json({
            success: false,
            message: "Failed to load transactions."
          });
        }

        res.json({
          success: true,
          balance: walletRows[0].balance,
          transactions: txRows
        });
      }
    );
  });
});




app.get("/api/admin/sales-records", (req, res) => {
  if (
  !req.session.user ||
  !["admin", "vendor"].includes(req.session.user.role)
) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const sql = `
    SELECT 
      asr.*,
      u.firstname,
      u.lastname,
      u.telephone,
      u.email,

      p.product_name,
      p.product_type,
      p.category,
      p.product_color,
      p.images,
      p.description,
      p.instructions,
      p.item_condition,
      p.phone_number AS product_phone_number

    FROM admin_sales_records asr

    LEFT JOIN users u 
      ON asr.seller_id = u.id

    LEFT JOIN products p 
      ON asr.product_id = p.id

    ORDER BY asr.id DESC
  `;

  db.query(sql, (err, results) => {
    if (err) {
      console.error("Sales records error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load sales records."
      });
    }

    res.json({ success: true, records: results });
  });
});

app.post("/api/admin/release-money/:id", (req, res) => {
  if (
  !req.session.user ||
  !["admin", "vendor"].includes(req.session.user.role)
) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const recordId = req.params.id;

  db.beginTransaction((txErr) => {
    if (txErr) {
      return res.status(500).json({ success: false, message: "Transaction failed." });
    }

    db.query(
      `
      SELECT * 
      FROM admin_sales_records 
      WHERE id = ? 
      FOR UPDATE
      `,
      [recordId],
      (err, rows) => {
        if (err || rows.length === 0) {
          return db.rollback(() => {
            res.status(404).json({
              success: false,
              message: "Sales record not found."
            });
          });
        }

        const record = rows[0];

        if (record.release_status === "released") {
          return db.rollback(() => {
            res.status(400).json({
              success: false,
              message: "Money has already been released."
            });
          });
        }

        if (record.release_status === "reversed") {
          return db.rollback(() => {
            res.status(400).json({
              success: false,
              message: "This money has already been reversed to buyer."
            });
          });
        }

        const amount = Number(record.balance_amount || record.total_amount);
        const sellerId = record.seller_id;

        if (amount <= 0) {
          return db.rollback(() => {
            res.status(400).json({
              success: false,
              message: "No amount available to release."
            });
          });
        }

        db.query(
          `
          UPDATE admin_account
          SET balance = balance - ?,
              updated_at = NOW()
          WHERE id = 1 AND balance >= ?
          `,
          [amount, amount],
          (adminErr, adminResult) => {
            if (adminErr) {
              return db.rollback(() => {
                console.error("Admin deduction error:", adminErr);
                res.status(500).json({
                  success: false,
                  message: "Failed to deduct admin account."
                });
              });
            }

            if (adminResult.affectedRows === 0) {
              return db.rollback(() => {
                res.status(400).json({
                  success: false,
                  message: "Admin escrow balance is not enough."
                });
              });
            }

            db.query(
              `
              INSERT INTO user_wallets (user_id, balance)
              VALUES (?, ?)
              ON DUPLICATE KEY UPDATE 
                balance = balance + VALUES(balance),
                updated_at = NOW()
              `,
              [sellerId, amount],
              (walletErr) => {
                if (walletErr) {
                  return db.rollback(() => {
                    res.status(500).json({
                      success: false,
                      message: "Failed to credit seller wallet."
                    });
                  });
                }

                db.query(
                  `
                  INSERT INTO wallet_transactions
                  (user_id, type, amount, description)
                  VALUES (?, 'credit', ?, ?)
                  `,
                  [
                    sellerId,
                    amount,
                    `Payment released for ${record.product_name}`
                  ],
                  (txInsertErr) => {
                    if (txInsertErr) {
                      return db.rollback(() => {
                        res.status(500).json({
                          success: false,
                          message: "Failed to save wallet transaction."
                        });
                      });
                    }

                    db.query(
                      `
                      UPDATE admin_sales_records
                      SET 
                        release_status = 'released',
                        released_amount = ?,
                        balance_amount = 0.00,
                        total_amount = 0.00,
                        released_at = NOW()
                      WHERE id = ?
                      `,
                      [amount, recordId],
                      (updateErr) => {
                        if (updateErr) {
                          return db.rollback(() => {
                            res.status(500).json({
                              success: false,
                              message: "Failed to update admin sales record."
                            });
                          });
                        }

                        db.commit((commitErr) => {
                          if (commitErr) {
                            return db.rollback(() => {
                              res.status(500).json({
                                success: false,
                                message: "Failed to complete release."
                              });
                            });
                          }

                          res.json({
                            success: true,
                            message: `GH₵${amount.toFixed(2)} released to seller successfully.`
                          });
                        });
                      }
                    );
                  }
                );
              }
            );
          }
        );
      }
    );
  });
});



app.post("/api/admin/reverse-money/:id", (req, res) => {
  if (
  !req.session.user ||
  !["admin", "vendor"].includes(req.session.user.role)
) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const recordId = req.params.id;

  db.query(
    "SELECT * FROM admin_sales_records WHERE id = ? LIMIT 1",
    [recordId],
    (err, rows) => {
      if (err) {
        console.error("Reverse fetch error:", err);
        return res.status(500).json({ success: false, message: "Database error." });
      }

      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: "Sales record not found." });
      }

      const record = rows[0];

      if (!record.buyer_id) {
        return res.json({
          success: false,
          message: "Buyer ID is missing for this sales record."
        });
      }

      if (record.release_status === "released") {
        return res.json({
          success: false,
          message: "Money has already been released to seller. You cannot reverse it."
        });
      }

      if (record.release_status === "reversed") {
        return res.json({
          success: false,
          message: "Money has already been reversed to buyer."
        });
      }

      const amount = Number(
        Number(record.balance_amount) > 0
          ? record.balance_amount
          : record.total_amount
      );

      if (!amount || amount <= 0) {
        return res.json({
          success: false,
          message: "Invalid amount to reverse."
        });
      }

      db.beginTransaction((txErr) => {
        if (txErr) {
          return res.status(500).json({
            success: false,
            message: "Transaction failed."
          });
        }

        db.query(
          "UPDATE user_wallets SET balance = balance + ? WHERE user_id = ?",
          [amount, record.buyer_id],
          (walletErr) => {
            if (walletErr) {
              return db.rollback(() => {
                console.error("Buyer refund error:", walletErr);
                res.status(500).json({
                  success: false,
                  message: "Failed to refund buyer."
                });
              });
            }

            db.query(
              "UPDATE admin_account SET balance = balance - ? WHERE id = 1",
              [amount],
              (adminErr) => {
                if (adminErr) {
                  return db.rollback(() => {
                    console.error("Admin balance deduction error:", adminErr);
                    res.status(500).json({
                      success: false,
                      message: "Failed to deduct admin balance."
                    });
                  });
                }

                db.query(
                  `
                  INSERT INTO wallet_transactions
                  (user_id, type, amount, description)
                  VALUES (?, 'credit', ?, ?)
                  `,
                  [
                    record.buyer_id,
                    amount,
                    `Money reversed to buyer for ${record.product_name}`
                  ],
                  (transErr) => {
                    if (transErr) {
                      return db.rollback(() => {
                        console.error("Wallet transaction error:", transErr);
                        res.status(500).json({
                          success: false,
                          message: "Failed to save wallet transaction."
                        });
                      });
                    }

                    db.query(
                      `
                     UPDATE admin_sales_records 
SET 
  release_status = 'reversed',
  reversed_amount = ?,
  reversed_at = NOW(),
  released_amount = 0.00,
  balance_amount = 0.00,
  total_amount = 0.00
WHERE id = ?
                      `,
                      [amount, recordId],
                      (updateErr) => {
                        if (updateErr) {
                          return db.rollback(() => {
                            console.error("Reverse status error:", updateErr);
                            res.status(500).json({
                              success: false,
                              message: "Failed to update record."
                            });
                          });
                        }

                        db.commit((commitErr) => {
                          if (commitErr) {
                            return db.rollback(() => {
                              res.status(500).json({
                                success: false,
                                message: "Failed to complete reversal."
                              });
                            });
                          }

                          res.json({
                            success: true,
                            message: `GH₵${amount.toFixed(2)} reversed to buyer successfully.`
                          });
                        });
                      }
                    );
                  }
                );
              }
            );
          }
        );
      });
    }
  );
});

app.get("/api/admin/disputes", (req, res) => {
  if (
  !req.session.user ||
  !["admin", "vendor"].includes(req.session.user.role)
) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const sql = `
    SELECT 
      pp.id,
      pp.id AS purchase_id,
      pp.product_id,
      pp.buyer_id,
      pp.seller_id,
      pp.product_name,
      pp.buyer_name,
      pp.buyer_phone,
      pp.total_amount,
      pp.payment_status,
      pp.order_status,
      pp.buyer_confirm_status,
      pp.buyer_note,
      pp.created_at,
      p.images
    FROM purchased_products pp
    LEFT JOIN products p ON pp.product_id = p.id
    WHERE pp.buyer_confirm_status IN ('delayed', 'not received')
    ORDER BY pp.id DESC
  `;

  db.query(sql, (err, results) => {
    if (err) {
      console.error("Dispute fetch error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load disputes."
      });
    }

    const disputes = results.map(row => ({
      ...row,
      reason: row.buyer_note || row.buyer_confirm_status,
      status: row.buyer_confirm_status === "delayed" ? "reviewing" : "open",
      admin_note: ""
    }));

    res.json({ success: true, disputes });
  });
});


app.put("/api/admin/disputes/:id/status", (req, res) => {
 if (
  !req.session.user ||
  !["admin", "vendor"].includes(req.session.user.role)
) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const purchaseId = req.params.id;
  const { status, admin_note } = req.body;

  const allowed = ["open", "reviewing", "resolved", "rejected"];

  if (!allowed.includes(status)) {
    return res.status(400).json({
      success: false,
      message: "Invalid dispute status."
    });
  }

  let buyerConfirmStatus = "delayed";

  if (status === "resolved") {
    buyerConfirmStatus = "received";
  }

  if (status === "rejected") {
    buyerConfirmStatus = "waiting";
  }

  if (status === "open") {
    buyerConfirmStatus = "not received";
  }

  if (status === "reviewing") {
    buyerConfirmStatus = "delayed";
  }

  const note = admin_note || null;

  db.query(
    `
    UPDATE purchased_products
    SET buyer_confirm_status = ?, buyer_note = ?
    WHERE id = ?
    `,
    [buyerConfirmStatus, note, purchaseId],
    (err) => {
      if (err) {
        console.error("Dispute update error:", err);
        return res.status(500).json({
          success: false,
          message: "Failed to update dispute."
        });
      }

      res.json({
        success: true,
        message: "Dispute updated successfully."
      });
    }
  );
});



app.get("/api/admin/payments-overview", (req, res) => {
  if (
  !req.session.user ||
  !["admin", "vendor"].includes(req.session.user.role)
) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const accountSql = "SELECT * FROM admin_account WHERE id = 1 LIMIT 1";

  const recordsSql = `
    SELECT 
      asr.*,
      u.firstname,
      u.lastname,
      u.telephone,
      u.email
    FROM admin_sales_records asr
    LEFT JOIN users u ON asr.seller_id = u.id
    ORDER BY asr.id DESC
  `;

  db.query(accountSql, (accountErr, accountRows) => {
    if (accountErr) {
      return res.status(500).json({
        success: false,
        message: "Failed to load admin account."
      });
    }

    db.query(recordsSql, (recordsErr, records) => {
      if (recordsErr) {
        return res.status(500).json({
          success: false,
          message: "Failed to load payment records."
        });
      }

      res.json({
        success: true,
        account: accountRows[0] || { balance: 0 },
        records
      });
    });
  });
});


app.get("/api/product-details/:id", (req, res) => {
  const productId = req.params.id;

  db.query(
    "SELECT * FROM products WHERE id = ? LIMIT 1",
    [productId],
    (err, results) => {
      if (err) {
        console.error("Fetch product error:", err);
        return res.status(500).json({
          success: false,
          message: "Database error"
        });
      }

      console.log("PRODUCT ID:", productId);
      console.log("PRODUCT RESULT:", results);

      if (results.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Product not found"
        });
      }

      let product = results[0];

      try {
        product.images = product.images ? JSON.parse(product.images) : [];
      } catch {
        product.images = [];
      }

      res.json({
        success: true,
        product
      });
    }
  );
});


app.put("/api/products/update/:id", upload.array("images", 10), (req, res) => {

  console.log("\n========== PRODUCT UPDATE START ==========");
  console.log("Product ID:", req.params.id);

  console.log("\nBODY:");
  console.log(req.body);

  console.log("\nFILES:");
  console.log(req.files);

  const productId = req.params.id;

  const {
    category,
    product_name,
    product_type,
    price,
    product_color,
    quantity_in_stock,
    phone_number,
    instructions,
    description,
    item_condition,
    old_images,

    region,
    district,
    subcategory,
    negotiable,
    delivery_available,
    delivery_fee_type,
    delivery_time,
    pickup_available,
    exchange_possible,
    bulk_price,
    bulk_min_qty,
    promotion_type,
    registered_car,
    seller_name,
    youtube_link,
    specifications
  } = req.body;

  let existingImages = [];

  try {
    existingImages = old_images
      ? JSON.parse(old_images)
      : [];
  } catch (err) {
    console.log("Old images parse error:", err);
    existingImages = [];
  }

  const newImages = (req.files || []).map(file => {
    return `/uploads/products/${file.filename}`;
  });

  const finalImages = [
    ...existingImages,
    ...newImages
  ];

  let cleanSpecifications = {};

  try {
    cleanSpecifications = specifications
      ? JSON.parse(specifications)
      : {};
  } catch (err) {
    console.log("Specifications parse error:", err);
    cleanSpecifications = {};
  }

  console.log("\n========== FINAL VALUES ==========");
  console.log({
    category,
    product_name,
    product_type,
    price,
    product_color,
    quantity_in_stock,
    phone_number,
    instructions,
    description,
    item_condition,
    region,
    district,
    subcategory,
    negotiable,
    delivery_available,
    delivery_fee_type,
    delivery_time,
    pickup_available,
    exchange_possible,
    bulk_price,
    bulk_min_qty,
    promotion_type,
    registered_car,
    seller_name,
    youtube_link
  });

  console.log("\nSpecifications:");
  console.log(cleanSpecifications);

  console.log("\nImages:");
  console.log(finalImages);

  const sql = `
    UPDATE products SET
      category = ?,
      product_name = ?,
      product_type = ?,
      price = ?,
      product_color = ?,
      quantity_in_stock = ?,
      phone_number = ?,
      instructions = ?,
      description = ?,
      item_condition = ?,
      region = ?,
      district = ?,
      subcategory = ?,
      negotiable = ?,
      delivery_available = ?,
      delivery_fee_type = ?,
      delivery_time = ?,
      pickup_available = ?,
      exchange_possible = ?,
      bulk_price = ?,
      bulk_min_qty = ?,
      promotion_type = ?,
      registered_car = ?,
      seller_name = ?,
      youtube_link = ?,
      specifications = ?,
      images = ?
    WHERE id = ?
  `;

  const values = [
    category,
    product_name,
    product_type,
    price,
    product_color,
    quantity_in_stock,
    phone_number,
    instructions,
    description,
    item_condition,

    region || null,
    district || null,
    subcategory || null,
    negotiable || null,
    delivery_available || null,
    delivery_fee_type || null,
    delivery_time || null,
    pickup_available || null,
    exchange_possible || null,
    bulk_price || null,
    bulk_min_qty || null,
    promotion_type || null,
    registered_car || null,
    seller_name || null,
    youtube_link || null,

    JSON.stringify(cleanSpecifications),
    JSON.stringify(finalImages),

    productId
  ];

  console.log("\n========== SQL VALUES ==========");
  console.log(values);

  db.query(sql, values, (err, result) => {

    if (err) {

      console.log("\n========== MYSQL ERROR ==========");
      console.error(err);

      console.log("SQL Message:", err.sqlMessage);
      console.log("SQL Code:", err.code);
      console.log("SQL State:", err.sqlState);

      return res.status(500).json({
        success: false,
        message: err.sqlMessage || "Failed to update product."
      });
    }

    console.log("\n========== PRODUCT UPDATED ==========");
    console.log("Affected Rows:", result.affectedRows);
    console.log("Product ID:", productId);

    res.json({
      success: true,
      message: "Product updated successfully."
    });

  });

});

app.post("/api/wallet/load", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Please login first."
    });
  }

  const userId = req.session.user.id;
  const { amount, momo_number } = req.body;

  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({
      success: false,
      message: "Enter a valid amount."
    });
  }

  if (!momo_number) {
    return res.status(400).json({
      success: false,
      message: "Enter the number to deduct from."
    });
  }

  const loadAmount = Number(amount);

  db.beginTransaction((err) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: "Transaction failed."
      });
    }

    const walletSql = `
      INSERT INTO user_wallets (user_id, balance)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE 
      balance = balance + VALUES(balance),
      updated_at = CURRENT_TIMESTAMP
    `;

    db.query(walletSql, [userId, loadAmount], (walletErr) => {
      if (walletErr) {
        return db.rollback(() => {
          console.error("Load wallet error:", walletErr);
          res.status(500).json({
            success: false,
            message: "Failed to load wallet."
          });
        });
      }

      const transSql = `
        INSERT INTO wallet_transactions
        (user_id, type, amount, description)
        VALUES (?, 'credit', ?, ?)
      `;

      db.query(
        transSql,
        [
          userId,
          loadAmount,
          `Wallet loaded from ${momo_number}`
        ],
        (transErr) => {
          if (transErr) {
            return db.rollback(() => {
              console.error("Wallet transaction error:", transErr);
              res.status(500).json({
                success: false,
                message: "Failed to save transaction."
              });
            });
          }

          db.commit((commitErr) => {
            if (commitErr) {
              return db.rollback(() => {
                res.status(500).json({
                  success: false,
                  message: "Failed to complete wallet loading."
                });
              });
            }

            res.json({
              success: true,
              message: `GH₵${loadAmount.toFixed(2)} loaded successfully.`
            });
          });
        }
      );
    });
  });
});




app.post("/api/vendor/request", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Please login first."
    });
  }

  const user = req.session.user;
  const userId = user.id;
  const fullname = `${user.firstname || ""} ${user.lastname || ""}`.trim();
  const telephone = user.telephone || "";
  const email = user.email || "";
  const { message } = req.body;

  db.query(
    "SELECT id FROM vendor_requests WHERE user_id = ? AND status = 'pending' LIMIT 1",
    [userId],
    (checkErr, rows) => {
      if (checkErr) {
        return res.status(500).json({
          success: false,
          message: "Failed to check request."
        });
      }

      if (rows.length > 0) {
        return res.json({
          success: false,
          message: "You already have a pending vendor request."
        });
      }

      db.query(
        `
        INSERT INTO vendor_requests
        (user_id, fullname, telephone, email, message)
        VALUES (?, ?, ?, ?, ?)
        `,
        [
          userId,
          fullname,
          telephone,
          email,
          message || "I want to become a vendor on DIDWAPA."
        ],
        (insertErr) => {
          if (insertErr) {
            console.error("Vendor request error:", insertErr);
            return res.status(500).json({
              success: false,
              message: "Failed to send vendor request."
            });
          }

          res.json({
            success: true,
            message: "Your vendor request has been sent successfully."
          });
        }
      );
    }
  );
});

app.get("/api/admin/vendor-requests", (req, res) => {
  if (
  !req.session.user ||
  !["admin", "vendor"].includes(req.session.user.role)
) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized"
    });
  }

  const sql = `
    SELECT 
      vr.*,
      u.firstname,
      u.lastname,
      u.telephone,
      u.email,
      u.verification_status
    FROM vendor_requests vr
    LEFT JOIN users u ON vr.user_id = u.id
    ORDER BY vr.id DESC
  `;

  db.query(sql, (err, results) => {
    if (err) {
      console.error("Vendor requests error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load vendor requests."
      });
    }

    res.json({
      success: true,
      requests: results
    });
  });
});


app.post("/api/admin/vendor-requests/approve/:id", (req, res) => {
  if (
  !req.session.user ||
  !["admin", "vendor"].includes(req.session.user.role)
) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized"
    });
  }

  const requestId = req.params.id;

  db.query(
    "SELECT * FROM vendor_requests WHERE id = ? LIMIT 1",
    [requestId],
    (err, rows) => {
      if (err) {
        console.error("Find vendor request error:", err);
        return res.status(500).json({
          success: false,
          message: "Database error."
        });
      }

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Vendor request not found."
        });
      }

      const request = rows[0];

      db.beginTransaction((txErr) => {
        if (txErr) {
          return res.status(500).json({
            success: false,
            message: "Transaction failed."
          });
        }

        db.query(
          `
          UPDATE users 
          SET 
            verification_status = 'approved',
            role = 'vendor'
          WHERE id = ?
          `,
          [request.user_id],
          (userErr) => {
            if (userErr) {
              return db.rollback(() => {
                console.error("Approve user error:", userErr);
                res.status(500).json({
                  success: false,
                  message: "Failed to approve user."
                });
              });
            }

            db.query(
              "UPDATE vendor_requests SET status = 'approved' WHERE id = ?",
              [requestId],
              (requestErr) => {
                if (requestErr) {
                  return db.rollback(() => {
                    console.error("Approve request error:", requestErr);
                    res.status(500).json({
                      success: false,
                      message: "Failed to update request."
                    });
                  });
                }

                db.commit((commitErr) => {
                  if (commitErr) {
                    return db.rollback(() => {
                      res.status(500).json({
                        success: false,
                        message: "Failed to complete approval."
                      });
                    });
                  }

                  res.json({
                    success: true,
                    message: "Vendor approved successfully."
                  });
                });
              }
            );
          }
        );
      });
    }
  );
});


app.post("/api/admin/vendor-requests/reject/:id", (req, res) => {
  if (
  !req.session.user ||
  !["admin", "vendor"].includes(req.session.user.role)
) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized"
    });
  }

  const requestId = req.params.id;

  db.query(
    "SELECT * FROM vendor_requests WHERE id = ? LIMIT 1",
    [requestId],
    (err, rows) => {
      if (err) {
        return res.status(500).json({
          success: false,
          message: "Database error."
        });
      }

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Vendor request not found."
        });
      }

      const request = rows[0];

      db.beginTransaction((txErr) => {
        if (txErr) {
          return res.status(500).json({
            success: false,
            message: "Transaction failed."
          });
        }

        db.query(
          `
          UPDATE users 
          SET verification_status = 'rejected'
          WHERE id = ?
          `,
          [request.user_id],
          (userErr) => {
            if (userErr) {
              return db.rollback(() => {
                res.status(500).json({
                  success: false,
                  message: "Failed to reject user."
                });
              });
            }

            db.query(
              "UPDATE vendor_requests SET status = 'rejected' WHERE id = ?",
              [requestId],
              (requestErr) => {
                if (requestErr) {
                  return db.rollback(() => {
                    res.status(500).json({
                      success: false,
                      message: "Failed to update request."
                    });
                  });
                }

                db.commit((commitErr) => {
                  if (commitErr) {
                    return db.rollback(() => {
                      res.status(500).json({
                        success: false,
                        message: "Failed to complete rejection."
                      });
                    });
                  }

                  res.json({
                    success: true,
                    message: "Vendor request rejected."
                  });
                });
              }
            );
          }
        );
      });
    }
  );
});


app.get("/api/vendor/request/status", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Please login first."
    });
  }

  const userId = req.session.user.id;

  db.query(
    `
    SELECT *
    FROM vendor_requests
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT 1
    `,
    [userId],
    (err, rows) => {
      if (err) {
        console.error("Vendor request status error:", err);
        return res.status(500).json({
          success: false,
          message: "Failed to load request status."
        });
      }

      res.json({
        success: true,
        request: rows.length ? rows[0] : null
      });
    }
  );
});


app.delete("/api/vendor/request/delete/:id", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Please login first."
    });
  }

  const userId = req.session.user.id;
  const requestId = req.params.id;

  db.query(
    "DELETE FROM vendor_requests WHERE id = ? AND user_id = ?",
    [requestId, userId],
    (err, result) => {
      if (err) {
        console.error("Delete vendor request error:", err);
        return res.status(500).json({
          success: false,
          message: "Failed to delete request."
        });
      }

      if (result.affectedRows === 0) {
        return res.json({
          success: false,
          message: "Request not found."
        });
      }

      res.json({ 
        success: true,
        message: "Vendor request deleted successfully."
      });
    }
  );
});




///// Security route 
app.get("/api/admin/security-logs", (req, res) => {
  if (
  !req.session.user ||
  !["admin", "vendor"].includes(req.session.user.role)
) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized"
    });
  }

  const sql = `
    SELECT 
      sl.*,
      u.firstname,
      u.lastname,
      u.email
    FROM security_logs sl
    LEFT JOIN users u ON sl.user_id = u.id
    ORDER BY sl.id DESC
    LIMIT 100
  `;

  db.query(sql, (err, results) => {
    if (err) {
      console.error("Security logs error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load security logs."
      });
    }

    res.json({
      success: true,
      logs: results
    });
  });
});


/////Back Code
app.get("/api/user/me", (req, res) => {
  if (!req.session.user) {
    return res.json({
      success: false,
      message: "Not logged in"
    });
  }

  db.query(
    "SELECT id, firstname, lastname, email, role FROM users WHERE id = ? LIMIT 1",
    [req.session.user.id],
    (err, rows) => {
      if (err) {
        console.error("User fetch error:", err);

        return res.status(500).json({
          success: false,
          message: "Database error"
        });
      }

      if (rows.length === 0) {
        return res.json({
          success: false,
          message: "User not found"
        });
      }

      res.json({
        success: true,
        user: rows[0]
      });
    }
  );
});




/////ADMIN APPROVES 
app.get("/api/admin/vendor-permissions", (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const sql = `
    SELECT 
      u.id,
      u.firstname,
      u.lastname,
      u.email,
      u.telephone,
      u.role,
      COALESCE(vp.verify_vendor, 0) AS verify_vendor,
      COALESCE(vp.verify_products, 0) AS verify_products,
      COALESCE(vp.resolve_disputes, 0) AS resolve_disputes,
      COALESCE(vp.message_response, 0) AS message_response,
      COALESCE(vp.check_transactions, 0) AS check_transactions,
      COALESCE(vp.all_access, 0) AS all_access,
      COALESCE(vp.access_disabled, 0) AS access_disabled
    FROM users u
    LEFT JOIN vendor_permissions vp ON u.id = vp.vendor_id
    WHERE u.role = 'vendor'
    ORDER BY u.id DESC
  `;

  db.query(sql, (err, results) => {
    if (err) {
      console.error("Load vendor permissions error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load vendors."
      });
    }

    res.json({
      success: true,
      vendors: results
    });
  });
});

app.post("/api/admin/vendor-permissions/save", (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const {
    vendor_id,
    verify_vendor,
    verify_products,
    resolve_disputes,
    message_response,
    check_transactions,
    all_access,
    normal_control,
    access_disabled
  } = req.body;

  if (!vendor_id) {
    return res.status(400).json({
      success: false,
      message: "Vendor ID is required."
    });
  }

  const disabled = access_disabled ? 1 : 0;
  const normal = disabled ? 0 : (normal_control ? 1 : 0);
  const all = disabled || normal ? 0 : (all_access ? 1 : 0);

  const data = {
    verify_vendor: disabled || normal ? 0 : (all ? 1 : verify_vendor ? 1 : 0),
    verify_products: disabled || normal ? 0 : (all ? 1 : verify_products ? 1 : 0),
    resolve_disputes: disabled || normal ? 0 : (all ? 1 : resolve_disputes ? 1 : 0),
    message_response: disabled || normal ? 0 : (all ? 1 : message_response ? 1 : 0),
    check_transactions: disabled || normal ? 0 : (all ? 1 : check_transactions ? 1 : 0),
    all_access: all,
    normal_control: normal,
    access_disabled: disabled
  };

  const sql = `
    INSERT INTO vendor_permissions
    (
      vendor_id,
      verify_vendor,
      verify_products,
      resolve_disputes,
      message_response,
      check_transactions,
      all_access,
      normal_control,
      access_disabled
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      verify_vendor = VALUES(verify_vendor),
      verify_products = VALUES(verify_products),
      resolve_disputes = VALUES(resolve_disputes),
      message_response = VALUES(message_response),
      check_transactions = VALUES(check_transactions),
      all_access = VALUES(all_access),
      normal_control = VALUES(normal_control),
      access_disabled = VALUES(access_disabled),
      updated_at = NOW()
  `;

  db.query(
    sql,
    [
      vendor_id,
      data.verify_vendor,
      data.verify_products,
      data.resolve_disputes,
      data.message_response,
      data.check_transactions,
      data.all_access,
      data.normal_control,
      data.access_disabled
    ],
    (err) => {
      if (err) {
        console.error("Save permissions error:", err);
        return res.status(500).json({
          success: false,
          message: "Failed to save permissions."
        });
      }

      res.json({
        success: true,
        message: "Vendor permissions saved successfully."
      });
    }
  );
});



/////product conversation for admin 
// GET PRODUCT CHAT CONVERSATIONS
app.get("/api/admin/product-conversations", (req, res) => {
  if (
    !req.session.user ||
    !["admin", "vendor"].includes(req.session.user.role)
  ) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized."
    });
  }

  const sql = `
    SELECT 
      pm.product_id,
      p.product_name,
      p.images,
      MAX(pm.created_at) AS last_message_time,
      COUNT(pm.id) AS total_messages,

      buyer.id AS buyer_id,
      buyer.firstname AS buyer_firstname,
      buyer.lastname AS buyer_lastname,
      buyer.telephone AS buyer_phone,

      seller.id AS seller_id,
      seller.firstname AS seller_firstname,
      seller.lastname AS seller_lastname,
      seller.telephone AS seller_phone,

      (
        SELECT message 
        FROM product_messages 
        WHERE product_id = pm.product_id
        ORDER BY created_at DESC 
        LIMIT 1
      ) AS last_message

    FROM product_messages pm
    LEFT JOIN products p ON pm.product_id = p.id
    LEFT JOIN users buyer ON pm.sender_id = buyer.id
    LEFT JOIN users seller ON pm.receiver_id = seller.id

    GROUP BY pm.product_id
    ORDER BY last_message_time DESC
  `;

  db.query(sql, (err, results) => {
    if (err) {
      console.error("Product conversations error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load conversations."
      });
    }

    res.json({
      success: true,
      conversations: results
    });
  });
});


// GET ONE PRODUCT CHAT THREAD
app.get("/api/admin/product-conversations/:productId", (req, res) => {
  if (
    !req.session.user ||
    !["admin", "vendor"].includes(req.session.user.role)
  ) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized."
    });
  }

  const productId = req.params.productId;

  const sql = `
    SELECT 
      pm.*,
      p.product_name,

      sender.firstname AS sender_firstname,
      sender.lastname AS sender_lastname,
      sender.role AS sender_role,

      receiver.firstname AS receiver_firstname,
      receiver.lastname AS receiver_lastname,
      receiver.role AS receiver_role

    FROM product_messages pm
    LEFT JOIN products p ON pm.product_id = p.id
    LEFT JOIN users sender ON pm.sender_id = sender.id
    LEFT JOIN users receiver ON pm.receiver_id = receiver.id

    WHERE pm.product_id = ?
    ORDER BY pm.created_at ASC
  `;

  db.query(sql, [productId], (err, results) => {
    if (err) {
      console.error("Product thread error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load conversation."
      });
    }

    res.json({
      success: true,
      messages: results
    });
  });
});






/////Settings 
app.get("/api/auth/me", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Not logged in"
    });
  }

  res.json({
    success: true,
    user: {
      id: req.session.user.id,
      firstname: req.session.user.firstname,
      lastname: req.session.user.lastname,
      email: req.session.user.email,
      role: req.session.user.role
    }
  });
});

app.get("/api/vendor/my-permissions", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Not logged in"
    });
  }

  const user = req.session.user;

  if (user.role === "admin") {
    return res.json({
      success: true,
      role: "admin",
      permissions: {
        all_access: 1,
        access_disabled: 0
      }
    });
  }

  if (user.role !== "vendor") {
    return res.status(403).json({
      success: false,
      message: "Unauthorized"
    });
  }

  const sql = `
    SELECT *
    FROM vendor_permissions
    WHERE vendor_id = ?
    LIMIT 1
  `;

  db.query(sql, [user.id], (err, rows) => {
    if (err) {
      console.error("Permission fetch error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load permissions"
      });
    }

    const permissions = rows[0] || {
      verify_vendor: 0,
      verify_products: 0,
      resolve_disputes: 0,
      message_response: 0,
      check_transactions: 0,
      all_access: 0,
      access_disabled: 0
    };

    res.json({
      success: true,
      role: user.role,
      permissions
    });
  });
});




///// Wallet Top Up Payment Codes
///// Wallet Top Up Payment Codes
const crypto = require("crypto");
const axios = require("axios");

const THETELLER_MERCHANT_ID = "TTM-00009388";
const THETELLER_API_USER = "louis66a20ac942e74";
const THETELLER_API_KEY = "ZmVjZWZlZDc2MzA4OWU0YmZhOTk5MDBmMDAxNDhmOWY=";

const THETELLER_PROCESS_URL = "https://prod.theteller.net/v1.1/transaction/process";
const THETELLER_STATUS_URL = "https://prod.theteller.net/v1.1/users/transactions";

function generateReference() {
  return "DWTP" + Date.now() + Math.floor(Math.random() * 10000);
}

function logLine(title, data = "") {
  console.log("\n==============================");
  console.log(title);
  if (data) console.log(data);
  console.log("==============================\n");
}

function tellerAuthHeader() {
  return `Basic ${Buffer.from(`${THETELLER_API_USER}:${THETELLER_API_KEY}`).toString("base64")}`;
}

function getNetworkSwitch(phone) {
  const p = String(phone).replace(/\D/g, "");

  if (p.startsWith("024") || p.startsWith("025") || p.startsWith("054") || p.startsWith("055") || p.startsWith("059")) {
    return "MTN";
  }

  if (p.startsWith("020") || p.startsWith("050")) {
    return "VODAFONE";
  }

  if (p.startsWith("026") || p.startsWith("027") || p.startsWith("056") || p.startsWith("057")) {
    return "AIRTELTIGO";
  }

  return "MTN";
}

function formatTellerAmount(amount) {
  const amountPesewas = Math.round(Number(amount) * 100);
  return String(amountPesewas).padStart(12, "0");
}

function isPaymentSuccessful(result) {
  return (
    result?.code === "000" ||
    result?.code === "00" ||
    result?.status === "successful" ||
    result?.status === "approved" ||
    result?.status === "paid" ||
    result?.status === "success"
  );
}

app.post("/api/wallet/topup/initiate", (req, res) => {
  logLine("WALLET TOPUP INITIATE REQUEST", {
    sessionUser: req.session.user,
    body: req.body
  });

  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Please login first."
    });
  }

  const userId = req.session.user.id;
  const { amount, momo_number } = req.body;

  if (!amount || Number(amount) <= 0 || !momo_number) {
    return res.status(400).json({
      success: false,
      message: "Invalid top up details."
    });
  }

  const reference = generateReference();
  const tellerAmount = formatTellerAmount(amount);
  const rSwitch = getNetworkSwitch(momo_number);

  db.query(
    `INSERT INTO wallet_topups (user_id, amount, momo_number, reference, status)
     VALUES (?, ?, ?, ?, 'pending')`,
    [userId, amount, momo_number, reference],
    async (err) => {
      if (err) {
        console.error("TOPUP DB INSERT ERROR:", err);
        return res.status(500).json({
          success: false,
          message: "Failed to create top up."
        });
      }

      try {
        const payload = {
          merchant_id: THETELLER_MERCHANT_ID,
          transaction_id: reference,
          processing_code: "000200",
          amount: tellerAmount,
          currency: "GHS",
          desc: "DIDWAPA Wallet Top Up",
          "r-switch": rSwitch,
          subscriber_number: momo_number
        };

        logLine("SENDING REQUEST TO THETELLER", {
          url: THETELLER_PROCESS_URL,
          payload
        });

        const response = await axios.post(THETELLER_PROCESS_URL, payload, {
          headers: {
            "Content-Type": "application/json",
            Authorization: tellerAuthHeader()
          },
          timeout: 30000
        });

        logLine("THETELLER INITIATE RESPONSE", response.data);

        db.query(
          `UPDATE wallet_topups SET provider_response = ? WHERE reference = ?`,
          [JSON.stringify(response.data), reference],
          (updateErr) => {
            if (updateErr) console.error("SAVE PROVIDER RESPONSE ERROR:", updateErr);
          }
        );

        return res.json({
          success: true,
          message: "Payment prompt sent. Please approve on your phone.",
          reference
        });

      } catch (error) {
        console.error("THETELLER INITIATE ERROR:");
        console.error("Message:", error.message);
        console.error("Status:", error.response?.status);
        console.error("Data:", error.response?.data);

        db.query(
          `UPDATE wallet_topups SET status='failed', provider_response=? WHERE reference=?`,
          [JSON.stringify(error.response?.data || error.message), reference]
        );

        return res.status(500).json({
          success: false,
          message: "Could not send payment prompt."
        });
      }
    }
  );
});

app.get("/api/wallet/topup/check/:reference", (req, res) => {

  console.log("=================================");
  console.log("CHECK TOPUP STATUS ROUTE HIT");
  console.log("Reference:", req.params.reference);
  console.log("=================================");

  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Please login first."
    });
  }

  const userId = req.session.user.id;
  const reference = req.params.reference;

  db.query(
    `SELECT * FROM wallet_topups
     WHERE reference = ? AND user_id = ?
     LIMIT 1`,
    [reference, userId],
    async (err, rows) => {

      if (err) {
        console.error("TOPUP FETCH ERROR:", err);

        return res.status(500).json({
          success: false,
          message: "Failed to check payment."
        });
      }

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Topup record not found."
        });
      }

      const topup = rows[0];

      console.log("TOPUP RECORD:", topup);

      if (topup.status === "paid") {

        console.log("PAYMENT ALREADY CONFIRMED");

        return res.json({
          success: true,
          paid: true,
          message: "Payment already confirmed."
        });
      }

      try {

        const statusUrl =
          `${THETELLER_STATUS_URL}/${reference}/status`;

        console.log("=================================");
        console.log("CHECKING THETELLER STATUS URL");
        console.log(statusUrl);
        console.log("=================================");

        const statusResponse = await axios.get(statusUrl, {
          headers: {
            "Content-Type": "application/json",
            "Merchant-Id": THETELLER_MERCHANT_ID,
            "Cache-Control": "no-cache"
          }
        });

        const result = statusResponse.data;

        console.log("=================================");
        console.log("THETELLER STATUS RESPONSE");
        console.log(result);
        console.log("=================================");

        db.query(
          `UPDATE wallet_topups
           SET provider_response = ?
           WHERE reference = ?`,
          [JSON.stringify(result), reference]
        );

        const paymentApproved =
          result.code === "000" ||
          result.code === "00" ||
          result.status === "approved" ||
          result.status === "success" ||
          result.status === "successful" ||
          result.reason === "Transaction Successful";

        console.log("Payment confirmed status:", paymentApproved);

        if (!paymentApproved) {

          return res.json({
            success: true,
            paid: false,
            message:
              result.reason ||
              "Payment not confirmed yet."
          });
        }

        db.beginTransaction((txErr) => {

          if (txErr) {
            console.error("TRANSACTION START ERROR:", txErr);

            return res.status(500).json({
              success: false,
              message: "Transaction failed."
            });
          }

          db.query(
            `UPDATE wallet_topups
             SET status='paid'
             WHERE reference=? AND status='pending'`,
            [reference],
            (updateErr, updateResult) => {

              if (updateErr) {

                console.error("TOPUP UPDATE ERROR:", updateErr);

                return db.rollback(() => {
                  res.status(500).json({
                    success: false,
                    message: "Failed to update topup."
                  });
                });
              }

              console.log("TOPUP UPDATE RESULT:", updateResult);

              db.query(
                `INSERT INTO user_wallets (user_id, balance)
                 VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE
                 balance = balance + VALUES(balance),
                 updated_at = NOW()`,
                [userId, topup.amount],
                (walletErr, walletResult) => {

                  if (walletErr) {

                    console.error(
                      "USER_WALLETS UPDATE ERROR:",
                      walletErr
                    );

                    return db.rollback(() => {
                      res.status(500).json({
                        success: false,
                        message: "Failed to update wallet."
                      });
                    });
                  }

                  console.log(
                    "USER_WALLETS UPDATED:",
                    walletResult
                  );

                  db.query(
                    `INSERT INTO wallet_transactions
                     (user_id, type, amount, description)
                     VALUES (?, ?, ?, ?)`,
                    [
                      userId,
                      "credit",
                      topup.amount,
                      `Wallet loaded from ${topup.momo_number}`
                    ],
                    (transErr, transResult) => {

                      if (transErr) {

                        console.error(
                          "WALLET_TRANSACTIONS INSERT ERROR:",
                          transErr
                        );

                        return db.rollback(() => {
                          res.status(500).json({
                            success: false,
                            message:
                              "Failed to save wallet transaction."
                          });
                        });
                      }

                      console.log(
                        "WALLET_TRANSACTIONS INSERTED:",
                        transResult
                      );

                      db.commit((commitErr) => {

                        if (commitErr) {

                          console.error(
                            "COMMIT ERROR:",
                            commitErr
                          );

                          return db.rollback(() => {
                            res.status(500).json({
                              success: false,
                              message:
                                "Failed to complete payment."
                            });
                          });
                        }

                        console.log("=================================");
                        console.log("PAYMENT SUCCESSFULLY COMPLETED");
                        console.log("=================================");

                        return res.json({
                          success: true,
                          paid: true,
                          message:
                            "Payment confirmed and wallet updated."
                        });

                      });
                    }
                  );
                }
              );
            }
          );
        });

      } catch (error) {

        console.log("=================================");
        console.log("THETELLER STATUS CHECK ERROR");
        console.log("Message:", error.message);
        console.log("Status:", error.response?.status);
        console.log("Data:", error.response?.data);
        console.log("=================================");

        return res.json({
          success: true,
          paid: false,
          message:
            "Payment not confirmed yet. Click check again."
        });
      }
    }
  );
});




app.post("/api/product/momo/initiate", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "Please login first." });
  }

  const buyerId = req.session.user.id;
  const { product_id, quantity, momo_number, network, account_name } = req.body;

  if (!product_id || !quantity || !momo_number || !network) {
    return res.status(400).json({ success: false, message: "Missing MoMo payment details." });
  }

  db.query("SELECT * FROM products WHERE id = ? LIMIT 1", [product_id], async (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: "Failed to load product." });
    if (!rows.length) return res.status(404).json({ success: false, message: "Product not found." });

    const product = rows[0];
    const qty = Number(quantity);
    const stock = Number(product.quantity_in_stock);
    const totalAmount = Number(product.price) * qty;

    if (qty <= 0) return res.status(400).json({ success: false, message: "Invalid quantity." });
    if (stock <= 0) return res.status(400).json({ success: false, message: "This product is out of stock." });
    if (qty > stock) return res.status(400).json({ success: false, message: `Only ${stock} item(s) available.` });

    const reference = "DWP" + Date.now() + Math.floor(Math.random() * 10000);
    const amountPesewas = Math.round(totalAmount * 100);
    const tellerAmount = String(amountPesewas).padStart(12, "0");

    const rSwitch =
      network === "MTN" ? "MTN" :
      network === "Telecel" ? "VODAFONE" :
      "AIRTELTIGO";

    db.query(
      `INSERT INTO product_momo_payments 
       (buyer_id, product_id, quantity, momo_number, network, account_name, reference, amount, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [buyerId, product_id, qty, momo_number, network, account_name, reference, totalAmount],
      async (insertErr) => {
        if (insertErr) {
          console.error("PRODUCT MOMO INSERT ERROR:", insertErr);
          return res.status(500).json({ success: false, message: "Failed to start payment." });
        }

        try {
          const payload = {
            merchant_id: THETELLER_MERCHANT_ID,
            transaction_id: reference,
            processing_code: "000200",
            amount: tellerAmount,
            currency: "GHS",
            desc: `DIDWAPA Product Payment - ${product.product_name}`,
            "r-switch": rSwitch,
            subscriber_number: momo_number
          };

          console.log("PRODUCT MOMO THETELLER PAYLOAD:", payload);

          const response = await axios.post(THETELLER_PROCESS_URL, payload, {
            headers: {
              "Content-Type": "application/json",
              Authorization: tellerAuthHeader()
            }
          });

          console.log("PRODUCT MOMO THETELLER RESPONSE:", response.data);

          db.query(
            `UPDATE product_momo_payments SET provider_response=? WHERE reference=?`,
            [JSON.stringify(response.data), reference]
          );

          res.json({
            success: true,
            message: "Payment prompt sent. Approve on your phone.",
            reference
          });

        } catch (error) {
          console.error("PRODUCT MOMO INITIATE ERROR:", error.response?.data || error.message);

          db.query(
            `UPDATE product_momo_payments SET status='failed', provider_response=? WHERE reference=?`,
            [JSON.stringify(error.response?.data || error.message), reference]
          );

          res.status(500).json({
            success: false,
            message: "Could not send payment prompt."
          });
        }
      }
    );
  });
});






app.get("/api/product/momo/check/:reference", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "Please login first." });
  }

  const buyerId = req.session.user.id;
  const reference = req.params.reference;

  db.query(
    `SELECT * FROM product_momo_payments WHERE reference=? AND buyer_id=? LIMIT 1`,
    [reference, buyerId],
    async (err, payRows) => {
      if (err) return res.status(500).json({ success: false, message: "Failed to check payment." });
      if (!payRows.length) return res.status(404).json({ success: false, message: "Payment record not found." });

      const payment = payRows[0];

      if (payment.status === "paid") {
        return res.json({ success: true, paid: true, message: "Payment already confirmed." });
      }

      try {
        const statusUrl = `${THETELLER_STATUS_URL}/${reference}/status`;

        const statusResponse = await axios.get(statusUrl, {
          headers: {
            "Content-Type": "application/json",
            "Merchant-Id": THETELLER_MERCHANT_ID,
            "Cache-Control": "no-cache"
          }
        });

        const result = statusResponse.data;
        console.log("PRODUCT MOMO STATUS RESPONSE:", result);

        db.query(
          `UPDATE product_momo_payments SET provider_response=? WHERE reference=?`,
          [JSON.stringify(result), reference]
        );

        const isPaid =
          result.code === "000" ||
          result.code === "00" ||
          result.status === "approved" ||
          result.status === "successful" ||
          result.reason === "Transaction Successful";

        if (!isPaid) {
          return res.json({
            success: true,
            paid: false,
            message: result.reason || "Payment not confirmed yet."
          });
        }

        db.query("SELECT * FROM products WHERE id=? LIMIT 1", [payment.product_id], (productErr, productRows) => {
          if (productErr) return res.status(500).json({ success: false, message: "Failed to load product." });
          if (!productRows.length) return res.status(404).json({ success: false, message: "Product not found." });

          const product = productRows[0];
          const qty = Number(payment.quantity);
          const stock = Number(product.quantity_in_stock);
          const unitPrice = Number(product.price);
          const totalAmount = unitPrice * qty;
          const sellerId = product.posted_by;

          if (qty > stock) {
            return res.status(400).json({ success: false, message: "Not enough stock available." });
          }

          const buyerName = `${req.session.user.firstname || ""} ${req.session.user.lastname || ""}`.trim();
          const buyerPhone = req.session.user.telephone || "";

          db.beginTransaction((txErr) => {
            if (txErr) return res.status(500).json({ success: false, message: "Transaction failed." });

            db.query(
              `INSERT INTO purchased_products
               (
                 product_id, buyer_id, seller_id, buyer_name, buyer_phone,
                 product_name, quantity, unit_price, total_amount,
                 payment_status, order_status
               )
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', 'pending')`,
              [
                product.id,
                buyerId,
                sellerId,
                buyerName,
                buyerPhone,
                product.product_name,
                qty,
                unitPrice,
                totalAmount
              ],
              (purchaseErr, purchaseResult) => {
                if (purchaseErr) {
                  return db.rollback(() => res.status(500).json({ success: false, message: "Failed to save purchase." }));
                }

                const purchaseId = purchaseResult.insertId;

                db.query(
                  `INSERT INTO admin_sales_records
                   (
                     purchase_id, product_id, seller_id, buyer_id,
                     product_name, quantity, unit_price, total_amount,
                     balance_amount, payment_status
                   )
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid')`,
                  [
                    purchaseId,
                    product.id,
                    sellerId,
                    buyerId,
                    product.product_name,
                    qty,
                    unitPrice,
                    totalAmount,
                    totalAmount
                  ],
                  (adminErr) => {
                    if (adminErr) {
                      return db.rollback(() => res.status(500).json({ success: false, message: "Failed to save admin sales record." }));
                    }

                    db.query("UPDATE admin_account SET balance = balance + ? WHERE id = 1", [totalAmount], (adminAccountErr) => {
                      if (adminAccountErr) {
                        return db.rollback(() => res.status(500).json({ success: false, message: "Failed to update admin account." }));
                      }

                      db.query("UPDATE products SET quantity_in_stock = quantity_in_stock - ? WHERE id = ?", [qty, product.id], (stockErr) => {
                        if (stockErr) {
                          return db.rollback(() => res.status(500).json({ success: false, message: "Failed to update stock." }));
                        }

                        db.query(
                          `UPDATE product_momo_payments SET status='paid' WHERE reference=?`,
                          [reference],
                          (payUpdateErr) => {
                            if (payUpdateErr) {
                              return db.rollback(() => res.status(500).json({ success: false, message: "Failed to update payment record." }));
                            }

                            db.commit((commitErr) => {
                              if (commitErr) {
                                return db.rollback(() => res.status(500).json({ success: false, message: "Failed to complete purchase." }));
                              }

                              res.json({
                                success: true,
                                paid: true,
                                message: "Payment confirmed. Product purchased successfully."
                              });
                            });
                          }
                        );
                      });
                    });
                  }
                );
              }
            );
          });
        });

      } catch (error) {
        console.error("PRODUCT MOMO STATUS ERROR:", error.response?.data || error.message);

        res.json({
          success: true,
          paid: false,
          message: "Payment not confirmed yet. Try again."
        });
      }
    }
  );
});




/////Cart payments 
app.post("/api/cart/momo/initiate", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success:false, message:"Please login first." });
  }

  const buyerId = req.session.user.id;
  const { momo_number, network, account_name } = req.body;

  if (!momo_number || !network || !account_name) {
    return res.status(400).json({ success:false, message:"Missing payment details." });
  }

  db.query(
    `SELECT c.id AS cart_id, c.product_id, c.quantity, p.*
     FROM carts c
     JOIN products p ON p.id = c.product_id
     WHERE c.user_id = ?`,
    [buyerId],
    async (err, items) => {
      if (err) return res.status(500).json({ success:false, message:"Failed to load cart." });
      if (!items.length) return res.status(400).json({ success:false, message:"Your cart is empty." });

      let totalAmount = 0;

      for (const item of items) {
        const qty = Number(item.quantity);
        const stock = Number(item.quantity_in_stock);

        if (qty > stock) {
          return res.status(400).json({
            success:false,
            message:`${item.product_name} has only ${stock} item(s) in stock.`
          });
        }

        totalAmount += Number(item.price) * qty;
      }

      const reference = "DWCART" + Date.now() + Math.floor(Math.random() * 10000);
      const tellerAmount = String(Math.round(totalAmount * 100)).padStart(12, "0");

      const rSwitch =
        network === "MTN" ? "MTN" :
        network === "Telecel" ? "VODAFONE" :
        "AIRTELTIGO";

      db.query(
        `INSERT INTO cart_momo_payments
         (buyer_id, reference, momo_number, network, account_name, amount, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
        [buyerId, reference, momo_number, network, account_name, totalAmount],
        async (insertErr) => {
          if (insertErr) {
            console.error("CART MOMO INSERT ERROR:", insertErr);
            return res.status(500).json({ success:false, message:"Failed to start payment." });
          }

          try {
            const payload = {
              merchant_id: THETELLER_MERCHANT_ID,
              transaction_id: reference,
              processing_code: "000200",
              amount: tellerAmount,
              currency: "GHS",
              desc: "DIDWAPA Cart Payment",
              "r-switch": rSwitch,
              subscriber_number: momo_number
            };

            console.log("CART MOMO PAYLOAD:", payload);

            const response = await axios.post(THETELLER_PROCESS_URL, payload, {
              headers:{
                "Content-Type":"application/json",
                Authorization:tellerAuthHeader()
              }
            });

            console.log("CART MOMO RESPONSE:", response.data);

            db.query(
              `UPDATE cart_momo_payments SET provider_response=? WHERE reference=?`,
              [JSON.stringify(response.data), reference]
            );

            res.json({
              success:true,
              message:"Payment prompt sent. Approve on your phone.",
              reference
            });

          } catch (error) {
            console.error("CART MOMO INITIATE ERROR:", error.response?.data || error.message);

            db.query(
              `UPDATE cart_momo_payments SET status='failed', provider_response=? WHERE reference=?`,
              [JSON.stringify(error.response?.data || error.message), reference]
            );

            res.status(500).json({ success:false, message:"Could not send payment prompt." });
          }
        }
      );
    }
  );
});



app.get("/api/cart/momo/check/:reference", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success:false, message:"Please login first." });
  }

  const buyerId = req.session.user.id;
  const reference = req.params.reference;

  db.query(
    `SELECT * FROM cart_momo_payments WHERE reference=? AND buyer_id=? LIMIT 1`,
    [reference, buyerId],
    async (err, payRows) => {
      if (err) return res.status(500).json({ success:false, message:"Failed to check payment." });
      if (!payRows.length) return res.status(404).json({ success:false, message:"Payment record not found." });

      const payment = payRows[0];

      if (payment.status === "paid") {
        return res.json({ success:true, paid:true, message:"Payment already confirmed." });
      }

      try {
        const statusUrl = `${THETELLER_STATUS_URL}/${reference}/status`;

        const statusResponse = await axios.get(statusUrl, {
          headers:{
            "Content-Type":"application/json",
            "Merchant-Id":THETELLER_MERCHANT_ID,
            "Cache-Control":"no-cache"
          }
        });

        const result = statusResponse.data;

        db.query(
          `UPDATE cart_momo_payments SET provider_response=? WHERE reference=?`,
          [JSON.stringify(result), reference]
        );

        const isPaid =
          result.code === "000" ||
          result.code === "00" ||
          result.status === "approved" ||
          result.status === "successful" ||
          result.reason === "Transaction Successful";

        if (!isPaid) {
          return res.json({
            success:true,
            paid:false,
            message:result.reason || "Payment not confirmed yet."
          });
        }

        db.query(
          `SELECT c.id AS cart_id, c.product_id, c.quantity, p.*
           FROM carts c
           JOIN products p ON p.id = c.product_id
           WHERE c.user_id = ?`,
          [buyerId],
          (cartErr, items) => {
            if (cartErr) return res.status(500).json({ success:false, message:"Failed to load cart." });
            if (!items.length) return res.status(400).json({ success:false, message:"Cart is empty." });

            const buyerName = `${req.session.user.firstname || ""} ${req.session.user.lastname || ""}`.trim();
            const buyerPhone = req.session.user.telephone || "";

            db.beginTransaction((txErr) => {
              if (txErr) return res.status(500).json({ success:false, message:"Transaction failed." });

              let index = 0;

              function processNextItem() {
                if (index >= items.length) {
                  return db.query(
                    `UPDATE cart_momo_payments SET status='paid' WHERE reference=?`,
                    [reference],
                    (payErr) => {
                      if (payErr) return db.rollback(() => res.status(500).json({ success:false, message:"Failed to update payment." }));

                      db.query(`DELETE FROM carts WHERE user_id=?`, [buyerId], (clearErr) => {
                        if (clearErr) return db.rollback(() => res.status(500).json({ success:false, message:"Failed to clear cart." }));

                        db.commit((commitErr) => {
                          if (commitErr) return db.rollback(() => res.status(500).json({ success:false, message:"Failed to complete checkout." }));

                          return res.json({
                            success:true,
                            paid:true,
                            message:"Payment confirmed. Cart checkout completed successfully."
                          });
                        });
                      });
                    }
                  );
                }

                const item = items[index];
                const qty = Number(item.quantity);
                const stock = Number(item.quantity_in_stock);
                const unitPrice = Number(item.price);
                const totalAmount = unitPrice * qty;
                const sellerId = item.posted_by;

                if (qty > stock) {
                  return db.rollback(() => {
                    res.status(400).json({
                      success:false,
                      message:`${item.product_name} has only ${stock} item(s) in stock.`
                    });
                  });
                }

                db.query(
                  `INSERT INTO purchased_products
                   (
                     product_id, buyer_id, seller_id, buyer_name, buyer_phone,
                     product_name, quantity, unit_price, total_amount,
                     payment_status, order_status
                   )
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', 'pending')`,
                  [
                    item.product_id,
                    buyerId,
                    sellerId,
                    buyerName,
                    buyerPhone,
                    item.product_name,
                    qty,
                    unitPrice,
                    totalAmount
                  ],
                  (purchaseErr, purchaseResult) => {
                    if (purchaseErr) return db.rollback(() => res.status(500).json({ success:false, message:"Failed to save purchase." }));

                    const purchaseId = purchaseResult.insertId;

                    db.query(
                      `INSERT INTO admin_sales_records
                       (
                         purchase_id, product_id, seller_id, buyer_id,
                         product_name, quantity, unit_price, total_amount,
                         balance_amount, payment_status
                       )
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid')`,
                      [
                        purchaseId,
                        item.product_id,
                        sellerId,
                        buyerId,
                        item.product_name,
                        qty,
                        unitPrice,
                        totalAmount,
                        totalAmount
                      ],
                      (adminErr) => {
                        if (adminErr) return db.rollback(() => res.status(500).json({ success:false, message:"Failed to save admin record." }));

                        db.query(
                          `UPDATE admin_account SET balance = balance + ? WHERE id = 1`,
                          [totalAmount],
                          (adminAccErr) => {
                            if (adminAccErr) return db.rollback(() => res.status(500).json({ success:false, message:"Failed to update admin account." }));

                            db.query(
                              `UPDATE products SET quantity_in_stock = quantity_in_stock - ? WHERE id = ?`,
                              [qty, item.product_id],
                              (stockErr) => {
                                if (stockErr) return db.rollback(() => res.status(500).json({ success:false, message:"Failed to update stock." }));

                                index++;
                                processNextItem();
                              }
                            );
                          }
                        );
                      }
                    );
                  }
                );
              }

              processNextItem();
            });
          }
        );

      } catch (error) {
        console.error("CART MOMO CHECK ERROR:", error.response?.data || error.message);

        res.json({
          success:true,
          paid:false,
          message:"Payment not confirmed yet. Try again."
        });
      }
    }
  );
});





/////Counts
app.get("/api/admin/user-verification-count", (req, res) => {
  const sql = `
    SELECT COUNT(*) AS count
    FROM users
    WHERE verification_status = 'pending'
       OR verification_status = 'not_submitted'
       OR verification_status IS NULL
  `;

  db.query(sql, (err, results) => {
    if (err) {
      console.error("User verification count error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load verification count."
      });
    }

    res.json({
      success: true,
      count: results[0].count
    });
  });
});


app.get("/api/admin/seller-verification-count", (req, res) => {
  const sql = `
    SELECT COUNT(*) AS count
    FROM users
    WHERE role = 'vendor'
      AND (
        verification_status = 'pending'
        OR verification_status = 'not_submitted'
        OR verification_status IS NULL
      )
  `;

  db.query(sql, (err, results) => {
    if (err) {
      console.error("Seller verification count error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load seller verification count."
      });
    }

    res.json({
      success: true,
      count: results[0].count
    });
  });
});

app.get("/api/admin/pending-products-count", (req, res) => {
  const sql = `
    SELECT COUNT(*) AS count
    FROM products
    WHERE status = 'pending'
       OR status = 'under review'
  `;

  db.query(sql, (err, results) => {
    if (err) {
      console.error("Pending products count error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load pending products count."
      });
    }

    res.json({
      success: true,
      count: results[0].count
    });
  });
});



app.get("/api/admin/orders-escrow-count", (req, res) => {
  const sql = `
    SELECT COUNT(*) AS count
    FROM purchased_products
    WHERE order_status = 'pending'
       OR order_status = 'delivering'
       OR order_status = 'not delivered'
  `;

  db.query(sql, (err, results) => {
    if (err) {
      console.error("Orders escrow count error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load orders escrow count."
      });
    }

    res.json({
      success: true,
      count: results[0].count
    });
  });
});


app.get("/api/admin/disputes-count", (req, res) => {
  const sql = `
    SELECT COUNT(*) AS count
    FROM purchased_products
    WHERE buyer_confirm_status = 'delayed'
       OR buyer_confirm_status = 'not received'
  `;

  db.query(sql, (err, results) => {
    if (err) {
      console.error("Disputes count error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load disputes count."
      });
    }

    res.json({
      success: true,
      count: results[0].count
    });
  });
});







/////User Counts 
app.get("/api/cart/count", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Please login first."
    });
  }

  const userId = req.session.user.id;

  const sql = `
    SELECT COUNT(*) AS count
    FROM carts
    WHERE user_id = ?
  `;

  db.query(sql, [userId], (err, results) => {
    if (err) {
      console.error("Cart count error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load cart count."
      });
    }

    res.json({
      success: true,
      count: results[0].count
    });
  });
});



app.get("/api/seller/purchased-products-count", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Please login first."
    });
  }

  const sellerId = req.session.user.id;

  const sql = `
    SELECT COUNT(*) AS count
    FROM purchased_products
    WHERE seller_id = ?
  `;

  db.query(sql, [sellerId], (err, results) => {
    if (err) {
      console.error("Purchased products count error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load purchased products count."
      });
    }

    res.json({
      success: true,
      count: results[0].count
    });
  });
});


app.get("/api/product-messages/unread-count", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Please login first."
    });
  }

  const userId = req.session.user.id;

  const sql = `
    SELECT COUNT(*) AS count
    FROM product_messages
    WHERE receiver_id = ?
      AND read_status = 'unread'
  `;

  db.query(sql, [userId], (err, results) => {
    if (err) {
      console.error("Unread product messages count error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load unread message count."
      });
    }

    res.json({
      success: true,
      count: results[0].count
    });
  });
});


app.get("/api/report-messages/unread-count", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Please login first."
    });
  }

  const userId = req.session.user.id;

  const sql = `
    SELECT COUNT(*) AS count
    FROM report_messages
    WHERE user_id = ?
      AND sender = 'admin'
      AND read_status = 'unread'
  `;

  db.query(sql, [userId], (err, results) => {
    if (err) {
      console.error("Report messages unread count error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load report messages count."
      });
    }

    res.json({
      success: true,
      count: results[0].count
    });
  });
});


app.get("/api/my-products/count", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Please login first."
    });
  }

  const userId = req.session.user.id;

  const sql = `
    SELECT COUNT(*) AS count
    FROM products
    WHERE posted_by = ?
  `;

  db.query(sql, [userId], (err, results) => {
    if (err) {
      console.error("My products count error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load my products count."
      });
    }

    res.json({
      success: true,
      count: results[0].count
    });
  });
});





/////Read reciept 
app.post("/api/product-message/mark-read", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Please login first."
    });
  }

  const userId = req.session.user.id;
  const { product_id, other_id } = req.body;

  if (!product_id) {
    return res.status(400).json({
      success: false,
      message: "Missing product ID."
    });
  }

  let sql = `
    UPDATE product_messages
    SET read_status = 'read'
    WHERE product_id = ?
      AND receiver_id = ?
      AND read_status = 'unread'
  `;

  let values = [product_id, userId];

  if (other_id) {
    sql += ` AND sender_id = ?`;
    values.push(other_id);
  }

  db.query(sql, values, (err, result) => {
    if (err) {
      console.error("Mark product messages read error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to mark messages as read."
      });
    }

    res.json({
      success: true,
      updated: result.affectedRows
    });
  });
});



app.post("/api/report/messages/mark-read", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Please login first."
    });
  }

  const userId = req.session.user.id;

  const sql = `
    UPDATE report_messages
    SET read_status = 'read'
    WHERE user_id = ?
      AND sender = 'admin'
      AND read_status = 'unread'
  `;

  db.query(sql, [userId], (err, result) => {
    if (err) {
      console.error("Mark report messages read error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to mark report messages as read."
      });
    }

    res.json({
      success: true,
      updated: result.affectedRows
    });
  });
});



app.get("/api/admin/report-messages-unread-count", (req, res) => {
  const sql = `
    SELECT COUNT(*) AS count
    FROM report_messages
    WHERE read_status = 'unread'
  `;

  db.query(sql, (err, results) => {
    if (err) {
      console.error("Admin report unread count error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load unread reports count."
      });
    }

    res.json({
      success: true,
      count: results[0].count
    });
  });
});

app.post("/api/admin/report-messages/mark-read/:user_id", (req, res) => {
  if (!req.session.user || !["admin", "vendor"].includes(req.session.user.role)) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized."
    });
  }

  const userId = req.params.user_id;

  const sql = `
    UPDATE report_messages
    SET read_status = 'read'
    WHERE user_id = ?
      AND sender = 'user'
      AND read_status = 'unread'
  `;

  db.query(sql, [userId], (err, result) => {
    if (err) {
      console.error("Admin mark report messages read error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to mark messages as read."
      });
    }

    res.json({
      success: true,
      updated: result.affectedRows
    });
  });
});


/////Comments 
app.post("/api/products/:id/comments", (req, res) => {
  const productId = req.params.id;
  const userId = req.session.user ? req.session.user.id : null;
  const { comment } = req.body;

  if (!comment || comment.trim() === "") {
    return res.status(400).json({
      success: false,
      message: "Comment cannot be empty."
    });
  }

  const sql = `
    INSERT INTO product_comments (
      product_id,
      user_id,
      comment
    )
    VALUES (?, ?, ?)
  `;

  db.query(sql, [productId, userId, comment.trim()], (err) => {
    if (err) {
      console.error("Add comment error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to add comment."
      });
    }

    res.json({
      success: true,
      message: "Comment added successfully."
    });
  });
});


app.get("/api/products/:id/comments", (req, res) => {
  const productId = req.params.id;

  const sql = `
    SELECT 
      pc.id,
      pc.comment,
      pc.created_at,
      users.firstname,
      users.lastname
    FROM product_comments pc
    LEFT JOIN users ON pc.user_id = users.id
    WHERE pc.product_id = ?
    ORDER BY pc.id DESC
  `;

  db.query(sql, [productId], (err, results) => {
    if (err) {
      console.error("Fetch comments error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load comments."
      });
    }

    res.json({
      success: true,
      comments: results
    });
  });
});


app.get("/api/products/:id/related", (req, res) => {
  const productId = req.params.id;

  const sql = `
    SELECT 
      id,
      product_name,
      category,
      region,
      district,
      price,
      images
    FROM products
    WHERE status = 'approved'
      AND id != ?
      AND (
        category = (SELECT category FROM products WHERE id = ?)
        OR region = (SELECT region FROM products WHERE id = ?)
        OR product_name LIKE CONCAT('%', (SELECT product_name FROM products WHERE id = ?), '%')
      )
    ORDER BY id DESC
    LIMIT 10
  `;

  db.query(sql, [productId, productId, productId, productId], (err, results) => {
    if (err) {
      console.error("Related products error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load related products."
      });
    }

    res.json({
      success: true,
      products: results
    });
  });
});




//////Makes abd model calls 
app.get("/api/vehicle-models", (req, res) => {
  const { make } = req.query;

  if(!make){
    return res.status(400).json({
      success:false,
      message:"Make is required"
    });
  }

  const sql = `
    SELECT model_name 
    FROM vehicle_models
    WHERE make_name = ?
    ORDER BY model_name ASC
  `;

  db.query(sql, [make], (err, rows) => {
    if(err){
      console.error(err);
      return res.status(500).json({
        success:false,
        message:"Failed to load models"
      });
    }

    res.json({
      success:true,
      models: rows.map(r => r.model_name)
    });
  });
});






////Multer code 
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    console.error("MULTER ERROR:", err);

    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        message: "One or more images are too large. Please upload images below 15MB each."
      });
    }

    return res.status(400).json({
      success: false,
      message: err.message || "Upload error."
    });
  }

  next(err);
});


/////Forgot password codes 
app.post("/api/password/check-email", (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({
      success: false,
      message: "Email is required."
    });
  }

  const sql = `
    SELECT id, email, telephone 
    FROM users 
    WHERE email = ? 
    LIMIT 1
  `;

  db.query(sql, [email], (err, results) => {
    if (err) {
      console.error("CHECK EMAIL ERROR:", err);
      return res.status(500).json({
        success: false,
        message: "Server error."
      });
    }

    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No account found with this email."
      });
    }

    const user = results[0];
    const phone = user.telephone || "";
    const lastTwo = phone.slice(-2);

    return res.json({
      success: true,
      lastTwo
    });
  });
});


app.post("/api/password/send-code", async (req, res) => {
  const { email, telephone } = req.body;

  if (!email || !telephone) {
    return res.status(400).json({
      success: false,
      message: "Email and telephone are required."
    });
  }

  const sql = `
    SELECT id, email, telephone 
    FROM users 
    WHERE email = ? 
    LIMIT 1
  `;

  db.query(sql, [email], async (err, results) => {
    if (err) {
      console.error("SEND CODE CHECK ERROR:", err);
      return res.status(500).json({
        success: false,
        message: "Server error."
      });
    }

    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Account not found."
      });
    }

    const user = results[0];

    if (String(user.telephone).trim() !== String(telephone).trim()) {
      return res.status(400).json({
        success: false,
        message: "Phone number does not match this account."
      });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();

    resetCodes[email] = {
      code,
      verified: false,
      expiresAt: Date.now() + 10 * 60 * 1000
    };

    console.log("DIDWAPA RESET CODE:", code);

    /*
      Connect your SMS API here.
      Example message:
      Your DIDWAPA password reset code is 123456
    */

    return res.json({
      success: true,
      message: "Verification code sent."
    });
  });
});



app.post("/api/password/verify-code", (req, res) => {
  const { email, code } = req.body;

  if (!email || !code) {
    return res.status(400).json({
      success: false,
      message: "Email and code are required."
    });
  }

  const saved = resetCodes[email];

  if (!saved) {
    return res.status(400).json({
      success: false,
      message: "No reset code found. Please request a new code."
    });
  }

  if (Date.now() > saved.expiresAt) {
    delete resetCodes[email];

    return res.status(400).json({
      success: false,
      message: "Code has expired. Please request a new one."
    });
  }

  if (saved.code !== code) {
    return res.status(400).json({
      success: false,
      message: "Invalid verification code."
    });
  }

  resetCodes[email].verified = true;

  return res.json({
    success: true,
    message: "Code verified."
  });
});


app.post("/api/password/reset", async (req, res) => {
  const { email, newPassword } = req.body;

  if (!email || !newPassword) {
    return res.status(400).json({
      success: false,
      message: "Email and new password are required."
    });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({
      success: false,
      message: "Password must be at least 6 characters."
    });
  }

  const saved = resetCodes[email];

  if (!saved || saved.verified !== true) {
    return res.status(400).json({
      success: false,
      message: "Please verify your code first."
    });
  }

  try {
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const sql = `
      UPDATE users 
      SET pin_hash = ? 
      WHERE email = ?
    `;

    db.query(sql, [hashedPassword, email], (err, result) => {
      if (err) {
        console.error("PASSWORD RESET ERROR:", err);
        return res.status(500).json({
          success: false,
          message: "Failed to update password."
        });
      }

      delete resetCodes[email];

      return res.json({
        success: true,
        message: "Password updated successfully."
      });
    });

  } catch (error) {
    console.error("HASH PASSWORD ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Server error."
    });
  }
});



app.use(express.static(path.join(__dirname)));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});