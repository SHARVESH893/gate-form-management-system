import os
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from flask_bcrypt import Bcrypt
import jwt
import datetime
from functools import wraps
from mongoengine import connect
from mongoengine.queryset.base import BaseQuerySet
from bson import ObjectId
from models import User, Request, GateHistory

app = Flask(__name__)
# Secure key for JWT (minimum 32 bytes for SHA256)
app.config['SECRET_KEY'] = 'smart-gate-pass-secure-key-2026-v1-highly-confidential'

# Initialize MongoDB Connection
try:
    connect('smart_gate_pass', host='localhost', port=27017, serverSelectionTimeoutMS=2000)
    print("✓ Successfully connected to MongoDB")
except Exception as e:
    print("✗ ERROR: Could not connect to MongoDB. Please ensure MongoDB service is running on port 27017.")
    print(f"Details: {e}")

CORS(app)
bcrypt = Bcrypt(app)

# Helper to sanitize MongoDB Dict for JSON serialization
def clean_dict(obj):
    if isinstance(obj, dict):
        return {k: clean_dict(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set, BaseQuerySet)):
        return [clean_dict(x) for x in obj]
    if hasattr(obj, 'to_mongo'):
        return clean_dict(obj.to_mongo().to_dict())
    if isinstance(obj, ObjectId):
        return str(obj)
    if isinstance(obj, datetime.datetime):
        return obj.isoformat()
    return obj

# Authentication Decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('Authorization')
        if not token:
            return jsonify({'message': 'Token is missing!'}), 401
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=["HS256"])
            current_user = User.objects(email=data['email']).first()
        except:
            return jsonify({'message': 'Token is invalid!'}), 401
        return f(current_user, *args, **kwargs)
    return decorated

# Static File Serving
@app.route('/')
def serve_index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('.', path)

# API Routes
@app.route('/api/auth/register', methods=['POST'])
def register():
    data = request.get_json()
    if User.objects(email=data['email']).first():
        return jsonify({'success': False, 'message': 'Email already exists'}), 400
    
    role = data.get('role')
    dept = data.get('dept')
    year = data.get('year')
    section = data.get('section')

    # Restricted role check
    if role in ['admin', 'gate']:
        return jsonify({'success': False, 'message': 'Restricted accounts cannot be registered manually.'}), 403

    # Scope uniqueness checks
    if role == 'hod':
        if User.objects(role='hod', dept=dept).first():
             return jsonify({'success': False, 'message': f"An HOD is already registered for {dept}"}), 400
    elif role == 'staff':
        if User.objects(role='staff', dept=dept, year=year, section=section).first():
             return jsonify({'success': False, 'message': "A Class Advisor is already registered for this scope"}), 400
    elif role == 'warden':
        if User.objects(role='warden', year=year).first():
             return jsonify({'success': False, 'message': f"A Warden is already registered for Year {year}"}), 400

    user = User(
        name=data['name'],
        email=data['email'],
        password=data['password'],
        role=role,
        dept=dept,
        year=year,
        semester=data.get('semester'),
        section=section
    )
    user.hash_password()
    user.save()
    return jsonify({'success': True, 'message': 'User registered successfully'})

@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json()
    user = User.objects(email=data['email']).first()
    if user and user.check_password(data['password']):
        token = jwt.encode({
            'email': user.email,
            'role': user.role,
            'exp': datetime.datetime.now(datetime.UTC) + datetime.timedelta(hours=24)
        }, app.config['SECRET_KEY'], algorithm="HS256")
        
        return jsonify({
            'success': True,
            'token': token,
            'user': {
                'name': user.name,
                'email': user.email,
                'role': user.role,
                'dept': user.dept,
                'year': user.year,
                'semester': user.semester,
                'section': user.section
            }
        })
    return jsonify({'success': False, 'message': 'Invalid email or password'}), 401

@app.route('/api/requests', methods=['GET', 'POST'])
@token_required
def manage_requests(current_user):
    if request.method == 'POST':
        data = request.get_json()
        new_request = Request(
            student=current_user,
            student_name=current_user.name,
            student_email=current_user.email,
            dept=current_user.dept,
            year_sem_sec=f"Year {current_user.year} / Sem {current_user.semester} / Sec {current_user.section}",
            type=data['type'],
            resident_type=data['resident_type'],
            reason=data['reason'],
            from_date=data['from_date'],
            to_date=data['to_date'],
            days=data['days'],
            document=data.get('document')
        )
        new_request.save()
        return jsonify({'success': True, 'message': 'Request submitted'})
    
    if current_user.role == 'student':
        requests = Request.objects(student_email=current_user.email).order_by('-created_at')
    elif current_user.role == 'staff':
        requests = Request.objects(status='Pending', dept=current_user.dept, year_sem_sec__contains=f"Year {current_user.year} /").filter(year_sem_sec__contains=f"/ Sec {current_user.section}")
    elif current_user.role == 'hod':
        requests = Request.objects(status='Recommended', dept=current_user.dept)
    elif current_user.role == 'warden':
        requests = Request.objects(status='Pending Warden', year_sem_sec__contains=f"Year {current_user.year} /")
    else:
        requests = Request.objects().order_by('-created_at')

    # Convert to list of dicts for injection
    request_list = clean_dict(requests)
    
    # Inject history counts for Student, Staff and HOD
    if current_user.role in ['student', 'staff', 'hod']:
        for req in request_list:
            email = req.get('student_email')
            if email:
                req['leave_count'] = Request.objects(student_email=email, status='Approved', type='Leave').count()
                req['od_count'] = Request.objects(student_email=email, status='Approved', type='On Duty').count()
                
    return jsonify(request_list)

@app.route('/api/requests/<req_id>/status', methods=['PUT'])
@token_required
def update_status(current_user, req_id):
    data = request.get_json()
    req = Request.objects(id=req_id).first()
    if not req:
        return jsonify({'success': False, 'message': 'Request not found'}), 404
    
    role = current_user.role
    decision = data['decision']
    
    if decision == 'reject':
        req.status = f'Rejected by {role.upper()}'
    else:
        if role == 'staff':
            req.status = 'Recommended'
            req.staff_approval = True
        elif role == 'hod':
            if req.resident_type == 'Hosteller':
                req.status = 'Pending Warden'
            else:
                req.status = 'Approved'
                req.approved_at = datetime.datetime.now(datetime.UTC)
                # 6-Hour Validity
                req.expiry_timestamp = int((datetime.datetime.now(datetime.UTC) + datetime.timedelta(hours=6)).timestamp() * 1000)
            req.hod_approval = True
        elif role == 'warden':
            req.status = 'Approved'
            req.warden_approval = True
            req.approved_at = datetime.datetime.now(datetime.UTC)
            # 6-Hour Validity
            req.expiry_timestamp = int((datetime.datetime.now(datetime.UTC) + datetime.timedelta(hours=6)).timestamp() * 1000)
            
    req.save()
    return jsonify({'success': True})

@app.route('/api/gate/record', methods=['POST'])
@token_required
def gate_record(current_user):
    if current_user.role != 'gate':
        return jsonify({'message': 'Unauthorized'}), 403
    data = request.get_json()
    req_id = data.get('id')
    
    # Try to get most accurate details from the original request
    req = Request.objects(id=req_id).first() if req_id and len(req_id) == 24 else None
    
    history = GateHistory(
        request_id=str(req_id),
        name=req.student_name if req else data.get('name'),
        dept=req.dept if req else data.get('dept'),
        year_sem_sec=req.year_sem_sec if req else data.get('year_sem_sec'),
        outing_time=datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    )
    history.save()
    return jsonify({'success': True, 'record': clean_dict(history)})

@app.route('/api/gate/history', methods=['GET'])
@token_required
def gate_history(current_user):
    if current_user.role != 'gate':
        return jsonify({'message': 'Unauthorized'}), 403
    history = GateHistory.objects().order_by('-created_at')
    return jsonify(clean_dict(history))

@app.route('/api/gate/history/clear', methods=['POST'])
@token_required
def clear_gate_history(current_user):
    if current_user.role != 'gate':
        return jsonify({'message': 'Unauthorized'}), 403
    GateHistory.objects().delete()
    return jsonify({'success': True})

@app.route('/api/admin/users', methods=['GET'])
@token_required
def get_users(current_user):
    if current_user.role != 'admin':
        return jsonify({'message': 'Unauthorized'}), 403
    users = User.objects(role__ne='admin')
    return jsonify(clean_dict(users))

@app.route('/api/admin/users/<email>', methods=['PUT', 'DELETE'])
@token_required
def manage_user(current_user, email):
    if current_user.role != 'admin':
        return jsonify({'message': 'Unauthorized'}), 403
    
    user = User.objects(email=email).first()
    if not user:
        return jsonify({'message': 'User not found'}), 404
    
    if request.method == 'DELETE':
        user.delete()
        return jsonify({'success': True})
    
    if request.method == 'PUT':
        data = request.get_json()
        user.name = data.get('name', user.name)
        user.dept = data.get('dept', user.dept)
        user.year = data.get('year', user.year)
        user.semester = data.get('semester', user.semester)
        user.section = data.get('section', user.section)
        user.save()
        return jsonify({'success': True})

if __name__ == '__main__':
    # Initialize Default Users
    defaults = [
        {'name': 'System Admin', 'email': 'admin@portal.edu', 'password': 'adminportal123', 'role': 'admin'},
        {'name': 'Gate Security', 'email': 'gate@portal.edu', 'password': 'gateportal123', 'role': 'gate'}
    ]
    for def_user in defaults:
        if not User.objects(email=def_user['email']).first():
            user = User(
                name=def_user['name'],
                email=def_user['email'],
                password=def_user['password'],
                role=def_user['role']
            )
            user.hash_password()
            user.save()
            print(f"Default {def_user['role']} created: {def_user['email']}")
        
    app.run(debug=True, port=5000)
