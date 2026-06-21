require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./db');

const app = express();

app.use(cors())

app.get('/', (req, res) => {
    res.send('WebGIS Peternakan Berjalan');
});

app.get('/api/provinsi', async (req, res) => {

    try {

        const { hewan, tahun } = req.query

       

        let query = `
             SELECT
                nama_provinsi,
                produksi
            FROM "produksi_ternak "
            WHERE 1=1
        `

        const values = []

        if (hewan) {
            values.push(hewan)
            query += ` AND hewan = $${values.length}`
        }

        if (tahun) {
            values.push(tahun)
            query += ` AND tahun = $${values.length}`
        }

        const result = await pool.query(query, values)

        res.json(result.rows)

    } catch (err) {

        console.error(err)

        res.status(500).send(
            'Error database'
        )

    }

})

app.get('/api/populasi', async (req, res) => {

    try {

        const { hewan, tahun } = req.query

        let query = `
            SELECT
                nama_provinsi,
                populasi
            FROM populasi
            WHERE 1=1
        `

        const values = []

        if (hewan) {

            values.push(hewan)

            query += `
                AND hewan = $${values.length}
            `
        }

        if (tahun) {

            values.push(tahun)

            query += `
                AND tahun = $${values.length}
            `
        }

        const result =
            await pool.query(
                query,
                values
            )

        res.json(
            result.rows
        )

    } catch (err) {

        console.error(err)

        res.status(500).send(
            'Error database'
        )

    }

})


const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server berjalan di port ${PORT}`);
});
module.exports = app;