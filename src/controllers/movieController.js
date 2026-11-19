const axios = require('axios');
const pool = require('../config/db');

const movieController = {
    // 1. Lấy danh sách phim (kèm tìm kiếm & lọc trạng thái)
    getAllMovies: async (req, res) => {
        try {
            const { search, status } = req.query;
            let query = `
                SELECT m.*, 
                    COALESCE(json_agg(DISTINCT g.name) FILTER (WHERE g.name IS NOT NULL), '[]') as genres
                FROM Movies m
                LEFT JOIN Movie_Genres mg ON m.id = mg.movie_id
                LEFT JOIN Genres g ON mg.genre_id = g.id
            `;
            const conditions = [];
            const values = [];

            if (status) {
                values.push(status);
                conditions.push(`m.status = $${values.length}`);
            } else {
                conditions.push(`m.status IN ('Đang chiếu', 'Sắp chiếu')`);
            }

            if (search) {
                values.push(`%${search}%`);
                conditions.push(`m.title ILIKE $${values.length}`);
            }

            if (conditions.length > 0) {
                query += ` WHERE ${conditions.join(' AND ')}`;
            }

            query += ` GROUP BY m.id ORDER BY m.id DESC`;

            const result = await pool.query(query, values);
            res.status(200).json(result.rows);
        } catch (error) {
            console.error("Lỗi lấy danh sách phim:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    },

    // 2. Lấy chi tiết một bộ phim kèm thể loại và diễn viên
    getMovieById: async (req, res) => {
        try {
            const { id } = req.params;
            
            // Lấy thông tin phim và thể loại
            const movieRes = await pool.query(
                `SELECT m.*, 
                    COALESCE(json_agg(DISTINCT g.name) FILTER (WHERE g.name IS NOT NULL), '[]') as genres
                 FROM Movies m
                 LEFT JOIN Movie_Genres mg ON m.id = mg.movie_id
                 LEFT JOIN Genres g ON mg.genre_id = g.id
                 WHERE m.id = $1
                 GROUP BY m.id`,
                [id]
            );

            if (movieRes.rows.length === 0) {
                return res.status(404).json({ message: "Không tìm thấy bộ phim này!" });
            }

            const movie = movieRes.rows[0];

            // Lấy danh sách diễn viên
            const actorsRes = await pool.query(
                `SELECT a.id, a.name, a.avatar_url, ma.character_name
                 FROM Movie_Actors ma
                 JOIN Actors a ON ma.actor_id = a.id
                 WHERE ma.movie_id = $1`,
                [id]
            );

            movie.actors = actorsRes.rows;

            res.status(200).json(movie);
        } catch (error) {
            console.error("Lỗi lấy chi tiết phim:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    },

    // 3. Cập nhật trạng thái phim (Đang chiếu / Sắp chiếu / Lưu trữ)
    updateStatus: async (req, res) => {
        try {
            const { id } = req.params;
            const { status } = req.body;

            const validStatuses = ['Sắp chiếu', 'Đang chiếu', 'Lưu trữ'];
            if (!validStatuses.includes(status)) {
                return res.status(400).json({ message: "Trạng thái không hợp lệ! (Sắp chiếu, Đang chiếu, Lưu trữ)" });
            }

            const result = await pool.query(
                'UPDATE Movies SET status = $1 WHERE id = $2 RETURNING *',
                [status, id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ message: "Không tìm thấy phim để cập nhật" });
            }

            res.status(200).json({
                message: "Cập nhật trạng thái phim thành công!",
                movie: result.rows[0]
            });
        } catch (error) {
            console.error("Lỗi cập nhật trạng thái phim:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    },
    
    // 4. Kéo phim từ TMDB API (Transaction an toàn)
    fetchFromTMDB: async (req, res) => {
        const client = await pool.connect(); 

        try {
            const { tmdb_id } = req.body;
            if (!tmdb_id) return res.status(400).json({ message: "Vui lòng cung cấp tmdb_id" });

            const apiKey = process.env.TMDB_API_KEY;

            const movieRes = await axios.get(`https://api.themoviedb.org/3/movie/${tmdb_id}?api_key=${apiKey}&language=vi-VN`);
            const creditRes = await axios.get(`https://api.themoviedb.org/3/movie/${tmdb_id}/credits?api_key=${apiKey}&language=vi-VN`);
            
            const movieData = movieRes.data;
            const castData = creditRes.data.cast ? creditRes.data.cast.slice(0, 6) : [];

            await client.query('BEGIN'); 

            const checkMovie = await client.query('SELECT id FROM Movies WHERE tmdb_id = $1', [movieData.id]);
            if (checkMovie.rows.length > 0) {
                throw new Error("Phim này đã được thêm vào hệ thống từ trước!");
            }

            const insertMovie = await client.query(
                `INSERT INTO Movies (tmdb_id, title, poster_url, overview, duration, status)
                 VALUES ($1, $2, $3, $4, $5, 'Sắp chiếu') RETURNING id`,
                [
                    movieData.id,
                    movieData.title,
                    movieData.poster_path ? `https://image.tmdb.org/t/p/w500${movieData.poster_path}` : 'https://via.placeholder.com/500x750?text=No+Poster',
                    movieData.overview || 'Chưa có tóm tắt nội dung.',
                    movieData.runtime || 120
                ]
            );
            const newMovieId = insertMovie.rows[0].id;

            if (movieData.genres) {
                for (const genre of movieData.genres) {
                    let genreId;
                    const checkGenre = await client.query('SELECT id FROM Genres WHERE name = $1', [genre.name]);
                    
                    if (checkGenre.rows.length > 0) {
                        genreId = checkGenre.rows[0].id;
                    } else {
                        const insertGenre = await client.query('INSERT INTO Genres (name) VALUES ($1) RETURNING id', [genre.name]);
                        genreId = insertGenre.rows[0].id;
                    }
                    
                    await client.query('INSERT INTO Movie_Genres (movie_id, genre_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [newMovieId, genreId]);
                }
            }

            for (const actor of castData) {
                let actorId;
                const checkActor = await client.query('SELECT id FROM Actors WHERE name = $1', [actor.name]);
                
                if (checkActor.rows.length > 0) {
                    actorId = checkActor.rows[0].id;
                } else {
                    const avatarUrl = actor.profile_path ? `https://image.tmdb.org/t/p/w500${actor.profile_path}` : null;
                    const insertActor = await client.query('INSERT INTO Actors (name, avatar_url) VALUES ($1, $2) RETURNING id', [actor.name, avatarUrl]);
                    actorId = insertActor.rows[0].id;
                }
                
                await client.query(
                    'INSERT INTO Movie_Actors (movie_id, actor_id, character_name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', 
                    [newMovieId, actorId, actor.character || '']
                );
            }

            await client.query('COMMIT'); 

            res.status(201).json({
                message: "Đã kéo và lưu phim vào CSDL PostgreSQL thành công!",
                movie_id: newMovieId
            });

        } catch (error) {
            await client.query('ROLLBACK');
            console.error("Lỗi:", error.message);
            res.status(400).json({ message: error.message || "Lỗi máy chủ khi lưu phim" });
        } finally {
            client.release();
        }
    }
};

module.exports = movieController;
