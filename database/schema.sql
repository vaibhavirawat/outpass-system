CREATE DATABASE IF NOT EXISTS outpass_db;
USE outpass_db;
SET FOREIGN_KEY_CHECKS=0;
DROP TABLE IF EXISTS audit_logs, video_calls, notifications, check_in_out_records,
  outpass_status_history, outpasses, students, parents, wardens, hostel_blocks, users;
SET FOREIGN_KEY_CHECKS=1;

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  role ENUM('student','parent','warden','admin') NOT NULL,
  full_name VARCHAR(120) NOT NULL,
  phone_number VARCHAR(20),
  account_status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE hostel_blocks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(10) NOT NULL UNIQUE,
  gender ENUM('F','M') NOT NULL
);

-- block_id is NOT unique so multiple wardens per block can be supported later
CREATE TABLE wardens (
  user_id INT PRIMARY KEY,
  employee_id VARCHAR(30) NOT NULL UNIQUE,
  gender ENUM('F','M') NOT NULL,
  designation VARCHAR(80),
  block_id INT,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (block_id) REFERENCES hostel_blocks(id)
);

CREATE TABLE parents (
  user_id INT PRIMARY KEY,
  relationship VARCHAR(40),
  address VARCHAR(255),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE students (
  user_id INT PRIMARY KEY,
  roll_number VARCHAR(30) NOT NULL UNIQUE,
  gender ENUM('F','M') NOT NULL,
  date_of_birth DATE,
  course VARCHAR(60), branch VARCHAR(60),
  year_of_study TINYINT, semester TINYINT,
  block_id INT NOT NULL,
  room_number VARCHAR(10),
  parent_user_id INT NOT NULL,
  profile_photo VARCHAR(255),
  emergency_contact VARCHAR(20),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (block_id) REFERENCES hostel_blocks(id),
  FOREIGN KEY (parent_user_id) REFERENCES parents(user_id)
);

CREATE TABLE outpasses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  type ENUM('DAY_OUT','OVERNIGHT','EMERGENCY','WEEKEND') NOT NULL,
  from_at DATETIME NOT NULL,
  until_at DATETIME NOT NULL,
  expected_return_at DATETIME NOT NULL,
  destination VARCHAR(150) NOT NULL,
  purpose VARCHAR(150) NOT NULL,
  description TEXT,
  emergency_contact VARCHAR(20),
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING_PARENT_APPROVAL',
  parent_reason VARCHAR(255),
  warden_reason VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id) REFERENCES students(user_id),
  INDEX (status), INDEX (student_id, from_at)
);

CREATE TABLE outpass_status_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  outpass_id INT NOT NULL,
  from_status VARCHAR(32),
  to_status VARCHAR(32) NOT NULL,
  actor_id INT,
  note VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (outpass_id) REFERENCES outpasses(id),
  FOREIGN KEY (actor_id) REFERENCES users(id)
);

CREATE TABLE check_in_out_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  outpass_id INT NOT NULL,
  student_id INT NOT NULL,
  kind ENUM('CHECK_OUT','CHECK_IN') NOT NULL,
  gate VARCHAR(40) DEFAULT 'Main Gate',
  notes VARCHAR(255),
  verified_by INT,
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (outpass_id) REFERENCES outpasses(id),
  FOREIGN KEY (student_id) REFERENCES students(user_id),
  FOREIGN KEY (verified_by) REFERENCES users(id)
);

CREATE TABLE notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type VARCHAR(40) NOT NULL,
  message VARCHAR(400) NOT NULL,
  outpass_id INT,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (outpass_id) REFERENCES outpasses(id),
  INDEX (user_id, is_read)
);

CREATE TABLE video_calls (
  id INT AUTO_INCREMENT PRIMARY KEY,
  outpass_id INT NOT NULL,
  warden_id INT NOT NULL,
  parent_id INT NOT NULL,
  status ENUM('REQUESTED','ACTIVE','DECLINED','ENDED') NOT NULL DEFAULT 'REQUESTED',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP NULL,
  FOREIGN KEY (outpass_id) REFERENCES outpasses(id),
  FOREIGN KEY (warden_id) REFERENCES users(id),
  FOREIGN KEY (parent_id) REFERENCES users(id)
);

CREATE TABLE audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  action VARCHAR(60) NOT NULL,
  entity VARCHAR(40),
  entity_id INT,
  description VARCHAR(255),
  ip VARCHAR(45),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
