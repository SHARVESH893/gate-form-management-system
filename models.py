from mongoengine import Document, StringField, EmailField, DateTimeField, ReferenceField, IntField, BooleanField, CASCADE, connect
from flask_bcrypt import generate_password_hash, check_password_hash
import datetime

# Models for Smart Gate Pass System
class User(Document):
    name = StringField(required=True)
    email = EmailField(required=True, unique=True)
    password = StringField(required=True)
    role = StringField(required=True, choices=['student', 'staff', 'warden', 'hod', 'admin', 'gate'])
    dept = StringField()
    year = StringField()
    semester = StringField()
    section = StringField()
    created_at = DateTimeField(default=datetime.datetime.utcnow)

    def hash_password(self):
        self.password = generate_password_hash(self.password).decode('utf8')

    def check_password(self, password):
        return check_password_hash(self.password, password)

class Request(Document):
    student = ReferenceField(User, reverse_delete_rule=CASCADE)
    student_name = StringField()
    student_email = StringField()
    dept = StringField()
    year_sem_sec = StringField()
    type = StringField(choices=['Leave', 'On Duty'])
    resident_type = StringField(choices=['Day Scholar', 'Hosteller'])
    reason = StringField(required=True)
    from_date = StringField()
    to_date = StringField()
    days = IntField()
    document = StringField()  # Base64 string
    status = StringField(default='Pending')
    staff_approval = BooleanField(default=False)
    hod_approval = BooleanField(default=False)
    warden_approval = BooleanField(default=False)
    created_at = DateTimeField(default=datetime.datetime.utcnow)
    approved_at = DateTimeField()
    expiry_timestamp = IntField() # Added for 6-hour validity

class GateHistory(Document):
    request_id = StringField()
    name = StringField()
    dept = StringField()
    year_sem_sec = StringField()
    outing_time = StringField()
    created_at = DateTimeField(default=datetime.datetime.utcnow)
