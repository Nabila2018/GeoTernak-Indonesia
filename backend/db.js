const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'webgis_peternakan',
    password: '090111',
    port: 5432
});

module.exports = pool;