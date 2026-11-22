const axios = require('axios');
const pool = require('../config/db');

const movieController = {
    // 1. Lấy danh sách phim (kèm tìm kiếm, lọc trạng thái, tính avg_rating & review_count)
    getAllMovies: async (req, res) => {
        try {
            const { search, status } = req.query;
            let query = `
                SELECT 
                    m.*, 
                    COALESCE(json_agg(DISTINCT g.name) FILTER (WHERE g.name IS NOT NULL), '[]') as genres,
                    COUNT(DISTINCT r.id) as review_count,
                    COALESCE(ROUND(AVG(r.rating)::numeric, 1), m.vote_average, 0.0) as rating
                FROM Movies m
                LEFT JOIN Movie_Genres mg ON m.id = mg.movie_id
                LEFT JOIN Genres g ON mg.genre_id = g.id
                LEFT JOIN Reviews r ON m.id = r.movie_id
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

    // 2. Lấy chi tiết một bộ phim kèm thể loại, diễn viên và điểm đánh giá
    getMovieById: async (req, res) => {
        try {
            const { id } = req.params;
            
            const movieRes = await pool.query(
                `SELECT 
                    m.*, 
                    COALESCE(json_agg(DISTINCT g.name) FILTER (WHERE g.name IS NOT NULL), '[]') as genres,
                    COUNT(DISTINCT r.id) as review_count,
                    COALESCE(ROUND(AVG(r.rating)::numeric, 1), m.vote_average, 0.0) as rating
                 FROM Movies m
                 LEFT JOIN Movie_Genres mg ON m.id = mg.movie_id
                 LEFT JOIN Genres g ON mg.genre_id = g.id
                 LEFT JOIN Reviews r ON m.id = r.movie_id
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

    // 3. Cập nhật trạng thái phim
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

    // 4. Sửa thông tin phim (PUT /api/admin/movies/:id hoặc PUT /api/movies/:id)
    updateMovie: async (req, res) => {
        try {
            const { id } = req.params;
            const { title, duration, age_rating, overview, trailer_url, release_date, status, vote_average } = req.body;

            const validAgeRatings = ['P', 'K', 'T13', 'T16', 'T18'];
            if (age_rating && !validAgeRatings.includes(age_rating)) {
                return res.status(400).json({ message: "Độ tuổi không hợp lệ! Chỉ chấp nhận P, K, T13, T16, T18" });
            }

            const result = await pool.query(
                `UPDATE Movies 
                 SET title = COALESCE($1, title),
                     duration = COALESCE($2, duration),
                     age_rating = COALESCE($3, age_rating),
                     overview = COALESCE($4, overview),
                     trailer_url = COALESCE($5, trailer_url),
                     release_date = COALESCE($6, release_date),
                     status = COALESCE($7, status),
                     vote_average = COALESCE($8, vote_average)
                 WHERE id = $9 RETURNING *`,
                [title, duration, age_rating, overview, trailer_url, release_date, status, vote_average, id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ message: "Không tìm thấy phim để cập nhật!" });
            }

            res.status(200).json({
                message: "Cập nhật thông tin phim thành công!",
                movie: result.rows[0]
            });
        } catch (error) {
            console.error("Lỗi cập nhật phim:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    },

    // 5. Xóa phim (Chặn xóa nếu đã có Suất chiếu - Showtimes)
    deleteMovie: async (req, res) => {
        try {
            const { id } = req.params;

            // Kiểm tra xem phim đã có suất chiếu nào chưa
            const checkShowtime = await pool.query(
                'SELECT id FROM Showtimes WHERE movie_id = $1 LIMIT 1',
                [id]
            );

            if (checkShowtime.rows.length > 0) {
                return res.status(400).json({ 
                    message: "Không thể xóa phim này vì đã có suất chiếu được xếp lịch trong hệ thống! Vui lòng chuyển trạng thái sang 'Lưu trữ'." 
                });
            }

            // Nếu chưa có suất chiếu nào, tiến hành xóa (Movie_Genres và Movie_Actors sẽ tự động xóa nhờ ON DELETE CASCADE)
            const deleteRes = await pool.query('DELETE FROM Movies WHERE id = $1 RETURNING id, title', [id]);

            if (deleteRes.rows.length === 0) {
                return res.status(404).json({ message: "Không tìm thấy phim để xóa!" });
            }

            res.status(200).json({
                message: `Đã xóa thành công phim: "${deleteRes.rows[0].title}" khỏi hệ thống!`,
                deleted_id: deleteRes.rows[0].id
            });
        } catch (error) {
            console.error("Lỗi xóa phim:", error);
            res.status(500).json({ message: "Lỗi máy chủ nội bộ" });
        }
    },
    
    // 6. Kéo phim từ TMDB API (Hỗ trợ credits, videos, release_dates)
    fetchFromTMDB: async (req, res) => {
        const client = await pool.connect(); 

        try {
            const { tmdb_id } = req.body;
            if (!tmdb_id) return res.status(400).json({ message: "Vui lòng cung cấp tmdb_id" });

            const apiKey = process.env.TMDB_API_KEY;

            // Gọi API TMDB với append_to_response
            const tmdbUrl = `https://api.themoviedb.org/3/movie/${tmdb_id}?api_key=${apiKey}&language=vi-VN&append_to_response=credits,videos,release_dates`;
            const movieRes = await axios.get(tmdbUrl);
            const movieData = movieRes.data;

            // Bóc tách Cast (tối đa 6 diễn viên)
            const castData = movieData.credits?.cast ? movieData.credits.cast.slice(0, 6) : [];

            // Bóc tách Trailer YouTube
            let trailerUrl = null;
            if (movieData.videos?.results && movieData.videos.results.length > 0) {
                const trailerObj = movieData.videos.results.find(v => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser')) || movieData.videos.results[0];
                if (trailerObj && trailerObj.key) {
                    trailerUrl = `https://www.youtube.com/watch?v=${trailerObj.key}`;
                }
            }

            // Bóc tách Độ tuổi (Age Rating) từ release_dates (ưu tiên VN hoặc US)
            let ageRating = 'P';
            if (movieData.release_dates?.results) {
                const vnRelease = movieData.release_dates.results.find(r => r.iso_3166_1 === 'VN');
                const usRelease = movieData.release_dates.results.find(r => r.iso_3166_1 === 'US');
                const cert = (vnRelease?.release_dates?.[0]?.certification) || (usRelease?.release_dates?.[0]?.certification) || '';

                if (cert.includes('18') || cert === 'R' || cert === 'NC-17') ageRating = 'T18';
                else if (cert.includes('16') || cert === 'TV-MA') ageRating = 'T16';
                else if (cert.includes('13') || cert === 'PG-13') ageRating = 'T13';
                else if (cert.includes('K')) ageRating = 'K';
                else ageRating = 'P';
            }

            await client.query('BEGIN'); 

            // Kiểm tra xem phim đã có chưa
            const checkMovie = await client.query('SELECT id FROM Movies WHERE tmdb_id = $1', [movieData.id]);
            if (checkMovie.rows.length > 0) {
                throw new Error("Phim này đã được thêm vào hệ thống từ trước!");
            }

            const insertMovie = await client.query(
                `INSERT INTO Movies (tmdb_id, title, poster_url, overview, duration, age_rating, release_date, trailer_url, vote_average, status)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Sắp chiếu') RETURNING id`,
                [
                    movieData.id,
                    movieData.title,
                    movieData.poster_path ? `https://image.tmdb.org/t/p/w500${movieData.poster_path}` : 'https://via.placeholder.com/500x750?text=No+Poster',
                    movieData.overview || 'Chưa có tóm tắt nội dung.',
                    movieData.runtime || 120,
                    ageRating,
                    movieData.release_date || null,
                    trailerUrl,
                    movieData.vote_average ? parseFloat(movieData.vote_average.toFixed(1)) : 0.0
                ]
            );
            const newMovieId = insertMovie.rows[0].id;

            // Lưu thể loại
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

            // Lưu diễn viên
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
                message: "Đã kéo và lưu phim từ TMDB (kèm độ tuổi, trailer, diễn viên) thành công!",
                movie_id: newMovieId
            });

        } catch (error) {
            await client.query('ROLLBACK');
            console.error("Lỗi TMDB:", error.message);
            res.status(400).json({ message: error.message || "Lỗi máy chủ khi lưu phim" });
        } finally {
            client.release();
        }
    }
};

module.exports = movieController;
