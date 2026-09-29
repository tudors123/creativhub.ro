#!/usr/bin/env python3
"""app.py — Flask backend for Webcity Ro admin dashboard & contact form."""

import os
import secrets
import sqlite3
import time
from flask import Flask, request, jsonify, make_response, g

# Configuration — password MUST be set via environment
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', '')
if not ADMIN_PASSWORD:
    raise RuntimeError('ADMIN_PASSWORD environment variable is required')

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 512 * 1024  # 512KB max request size

# In-memory token store: {token: expiry_timestamp}
_tokens = {}
TOKEN_TTL = 8 * 3600  # 8 hours

# Login throttle: {ip: [timestamps]}
_login_attempts = {}
MAX_LOGIN_ATTEMPTS = 5
LOGIN_WINDOW = 300  # 5 minutes

# SQLite DB stored outside the static project tree
DATABASE = os.environ.get('DATABASE_PATH', '/tmp/webcityro-data.db')


def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db


@app.teardown_appcontext
def close_db(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row

    db.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            company TEXT,
            service TEXT,
            message TEXT NOT NULL,
            is_read INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    db.execute('''
        CREATE TABLE IF NOT EXISTS portfolio (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            category TEXT NOT NULL,
            description TEXT,
            client TEXT,
            year INTEGER,
            image_url TEXT,
            project_url TEXT,
            tags TEXT,
            sort_order INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # Seed portfolio if empty
    count = db.execute('SELECT COUNT(*) FROM portfolio').fetchone()[0]
    if count == 0:
        items = [
            ('Keksen', 'Web Design', 'Magazin online pentru un brand de biscuiți artizanali. Design modern, navigare intuitivă și optimizat pentru conversii.', 'Keksen', 2024, '/assets/portfolio-keksen.jpg', 'https://keksen.ro.creativhub.ro/', 'E-commerce,Web Design', 0),
            ('Tinichigerie GD', 'Web Design', 'Site corporativ pentru atelier auto de tinichigerie din Sibiu. Prezentare profesională a serviciilor și portofoliu de lucrări.', 'Tinichigerie GD', 2024, '/assets/portfolio-tinichigerie.jpg', 'https://tinichigeriegd.ro/', 'Corporate,Auto', 1),
            ('Brand Identity Lumina', 'Branding', 'Identitate vizuală completă pentru brandul de cosmetice Lumina Cosmetics. Logo, paletă de culori, tipografie și ghid de brand.', 'Lumina Cosmetics', 2024, '/assets/portfolio-1.png', '', 'Logo,Identitate vizuală', 2),
            ('Social Media EcoFresh', 'Social Media', 'Campanie de social media pentru brandul de produse eco EcoFresh. Strategie de conținut, creare de postări și management al comunității.', 'EcoFresh', 2024, '/assets/portfolio-2.png', '', 'Instagram,Facebook,Content', 3),
            ('SEO TechFlow', 'SEO', 'Optimizare SEO completă pentru compania de software TechFlow. Cercetare de cuvinte cheie, optimizare on-page și strategie de conținut.', 'TechFlow', 2024, '/assets/portfolio-3.png', '', 'SEO,Optimizare,Analytics', 4),
            ('Ads UrbanBite', 'Publicitate Digitală', 'Campanie de Google și Meta Ads pentru lanțul de restaurante UrbanBite. Strategie, creare de reclame și optimizare continuă.', 'UrbanBite', 2024, '/assets/portfolio-4.png', '', 'Google Ads,Meta Ads,PPC', 5),
        ]
        db.executemany(
            'INSERT INTO portfolio (title, category, description, client, year, image_url, project_url, tags, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            items
        )

    db.commit()
    db.close()


# ===== CORS (same-origin only, no wildcard) =====
@app.before_request
def handle_preflight():
    if request.method == 'OPTIONS':
        r = make_response()
        r.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        r.headers.add('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS')
        return r


@app.after_request
def add_cors(response):
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS')
    return response


# ===== AUTH =====
def _clean_expired_tokens():
    now = time.time()
    expired = [t for t, exp in _tokens.items() if exp < now]
    for t in expired:
        del _tokens[t]


def _check_login_throttle(ip):
    now = time.time()
    attempts = _login_attempts.get(ip, [])
    # Keep only attempts within the window
    recent = [a for a in attempts if now - a < LOGIN_WINDOW]
    _login_attempts[ip] = recent
    return len(recent) >= MAX_LOGIN_ATTEMPTS


def _record_login_attempt(ip):
    _login_attempts.setdefault(ip, []).append(time.time())


def is_authenticated():
    auth = request.headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        return False
    token = auth[7:]
    _clean_expired_tokens()
    exp = _tokens.get(token)
    if exp is None:
        return False
    if exp < time.time():
        del _tokens[token]
        return False
    return True


def require_auth_or_401():
    if not is_authenticated():
        return jsonify({'error': 'Neautentificat'}), 401
    return None


def _get_client_ip():
    return request.environ.get('HTTP_X_FORWARDED_FOR', request.remote_addr or 'unknown').split(',')[0].strip()


# ===== PUBLIC API =====

@app.route('/api/contact', methods=['POST'])
def submit_contact():
    data = request.json or {}
    name = (data.get('name') or '').strip()[:100]
    email = (data.get('email') or '').strip()[:200]
    company = (data.get('company') or '').strip()[:100]
    service = (data.get('service') or '').strip()[:100]
    message = (data.get('message') or '').strip()[:5000]

    if not name or not email or not message:
        return jsonify({'error': 'Campuri obligatorii lipsesc'}), 400

    # Basic email format check
    if '@' not in email or '.' not in email:
        return jsonify({'error': 'Email invalid'}), 400

    db = get_db()
    db.execute(
        'INSERT INTO messages (name, email, company, service, message) VALUES (?, ?, ?, ?, ?)',
        [name, email, company, service, message]
    )
    db.commit()
    return jsonify({'success': True, 'message': 'Mesaj trimis cu succes'}), 201


@app.route('/api/portfolio', methods=['GET'])
def public_portfolio():
    db = get_db()
    rows = db.execute('SELECT * FROM portfolio ORDER BY sort_order ASC').fetchall()
    result = []
    for r in rows:
        result.append({
            'id': r['id'],
            'title': r['title'],
            'category': r['category'],
            'description': r['description'],
            'client': r['client'],
            'year': r['year'],
            'image_url': r['image_url'],
            'project_url': r['project_url'],
            'tags': r['tags'].split(',') if r['tags'] else [],
            'sort_order': r['sort_order'],
        })
    return jsonify(result)


# ===== ADMIN API =====

@app.route('/api/admin/login', methods=['POST'])
def admin_login():
    ip = _get_client_ip()
    if _check_login_throttle(ip):
        return jsonify({'error': 'Prea multe încercări. Încearcă din nou peste 5 minute.'}), 429
    data = request.json or {}
    password = data.get('password', '')
    if password == ADMIN_PASSWORD:
        token = secrets.token_urlsafe(32)
        _tokens[token] = time.time() + TOKEN_TTL
        _login_attempts.pop(ip, None)
        return jsonify({'success': True, 'token': token})
    _record_login_attempt(ip)
    return jsonify({'error': 'Parolă incorectă'}), 401


@app.route('/api/admin/logout', methods=['POST'])
def admin_logout():
    auth = request.headers.get('Authorization', '')
    if auth.startswith('Bearer '):
        token = auth[7:]
        _tokens.pop(token, None)
    return jsonify({'success': True})


@app.route('/api/admin/auth', methods=['GET'])
def admin_auth_check():
    if is_authenticated():
        return jsonify({'authenticated': True})
    return jsonify({'authenticated': False}), 401


@app.route('/api/admin/stats', methods=['GET'])
def admin_stats():
    if not is_authenticated():
        return jsonify({'error': 'Neautentificat'}), 401
    db = get_db()
    total = db.execute('SELECT COUNT(*) FROM messages').fetchone()[0]
    unread = db.execute('SELECT COUNT(*) FROM messages WHERE is_read = 0').fetchone()[0]
    portfolio_count = db.execute('SELECT COUNT(*) FROM portfolio').fetchone()[0]
    recent = db.execute(
        'SELECT id, name, email, service, is_read, created_at FROM messages ORDER BY created_at DESC LIMIT 5'
    ).fetchall()
    return jsonify({
        'total_messages': total,
        'unread_messages': unread,
        'portfolio_count': portfolio_count,
        'recent_messages': [dict(m) for m in recent],
    })


@app.route('/api/admin/messages', methods=['GET'])
def admin_messages():
    if not is_authenticated():
        return jsonify({'error': 'Neautentificat'}), 401
    db = get_db()
    rows = db.execute('SELECT * FROM messages ORDER BY created_at DESC').fetchall()
    return jsonify([dict(r) for r in rows])


@app.route('/api/admin/messages/<int:mid>', methods=['PATCH'])
def admin_message_toggle(mid):
    if not is_authenticated():
        return jsonify({'error': 'Neautentificat'}), 401
    data = request.json or {}
    is_read = data.get('is_read')
    db = get_db()
    if is_read is not None:
        db.execute('UPDATE messages SET is_read = ? WHERE id = ?', [int(is_read), mid])
        db.commit()
    return jsonify({'success': True})


@app.route('/api/admin/messages/<int:mid>', methods=['DELETE'])
def admin_message_delete(mid):
    if not is_authenticated():
        return jsonify({'error': 'Neautentificat'}), 401
    db = get_db()
    db.execute('DELETE FROM messages WHERE id = ?', [mid])
    db.commit()
    return jsonify({'success': True})


@app.route('/api/admin/portfolio', methods=['GET'])
def admin_portfolio_list():
    if not is_authenticated():
        return jsonify({'error': 'Neautentificat'}), 401
    db = get_db()
    rows = db.execute('SELECT * FROM portfolio ORDER BY sort_order ASC').fetchall()
    result = []
    for r in rows:
        result.append({
            'id': r['id'],
            'title': r['title'],
            'category': r['category'],
            'description': r['description'],
            'client': r['client'],
            'year': r['year'],
            'image_url': r['image_url'],
            'project_url': r['project_url'],
            'tags': r['tags'].split(',') if r['tags'] else [],
            'sort_order': r['sort_order'],
        })
    return jsonify(result)


@app.route('/api/admin/portfolio', methods=['POST'])
def admin_portfolio_create():
    if not is_authenticated():
        return jsonify({'error': 'Neautentificat'}), 401
    data = request.json or {}
    # Validate and truncate fields
    title = (data.get('title') or '').strip()[:200]
    category = (data.get('category') or '').strip()[:100]
    if not title or not category:
        return jsonify({'error': 'Titlu și categorie sunt obligatorii'}), 400
    description = (data.get('description') or '').strip()[:2000]
    client = (data.get('client') or '').strip()[:100]
    year = data.get('year')
    image_url = (data.get('image_url') or '').strip()[:500]
    project_url = (data.get('project_url') or '').strip()[:500]
    tags = ','.join([str(t)[:50] for t in (data.get('tags') or [])])
    sort_order = int(data.get('sort_order') or 0)
    db = get_db()
    cur = db.execute(
        'INSERT INTO portfolio (title, category, description, client, year, image_url, project_url, tags, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [title, category, description, client, year, image_url, project_url, tags, sort_order]
    )
    db.commit()
    return jsonify({'success': True, 'id': cur.lastrowid}), 201


@app.route('/api/admin/portfolio/<int:pid>', methods=['PUT'])
def admin_portfolio_update(pid):
    if not is_authenticated():
        return jsonify({'error': 'Neautentificat'}), 401
    data = request.json or {}
    # Validate and truncate fields
    title = (data.get('title') or '').strip()[:200]
    category = (data.get('category') or '').strip()[:100]
    if not title or not category:
        return jsonify({'error': 'Titlu și categorie sunt obligatorii'}), 400
    description = (data.get('description') or '').strip()[:2000]
    client = (data.get('client') or '').strip()[:100]
    year = data.get('year')
    image_url = (data.get('image_url') or '').strip()[:500]
    project_url = (data.get('project_url') or '').strip()[:500]
    tags = ','.join([str(t)[:50] for t in (data.get('tags') or [])])
    sort_order = int(data.get('sort_order') or 0)
    db = get_db()
    db.execute(
        '''UPDATE portfolio SET
           title=?, category=?, description=?, client=?, year=?,
           image_url=?, project_url=?, tags=?, sort_order=?
           WHERE id=?''',
        [title, category, description, client, year, image_url, project_url, tags, sort_order, pid]
    )
    db.commit()
    return jsonify({'success': True})


@app.route('/api/admin/portfolio/<int:pid>', methods=['DELETE'])
def admin_portfolio_delete(pid):
    if not is_authenticated():
        return jsonify({'error': 'Neautentificat'}), 401
    db = get_db()
    db.execute('DELETE FROM portfolio WHERE id = ?', [pid])
    db.commit()
    return jsonify({'success': True})


# Initialize database on startup
init_db()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)
