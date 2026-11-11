const axios = require('axios');
const pool = require('../config/db'); // Nhúng kết nối CSDL

const movieController = {
    fetchFromTMDB: async (req, res) => {
        // Lấy 1 kết nối riêng biệt để chạy Transaction
        const client = await pool.connect(); 

        try {
            const { tmdb_id } = req.body;
            if (!tmdb_id) return res.status(400).json({ message: "Vui lòng cung cấp tmdb_id" });

            const apiKey = process.env.TMDB_API_KEY;

            // 1. GỌI API TMDB
            const movieRes = await axios.get(`https://api.themoviedb.org/3/movie/${tmdb_id}?api_key=${apiKey}&language=vi-VN`);
            const creditRes = await axios.get(`https://api.themoviedb.org/3/movie/${tmdb_id}/credits?api_key=${apiKey}&language=vi-VN`);
            
            const movieData = movieRes.data;
            const castData = creditRes.data.cast.slice(0, 5); // Chỉ lấy 5 diễn viên

            // 2. BẮT ĐẦU TRANSACTION CƠ SỞ DỮ LIỆU
            await client.query('BEGIN'); 

            // BƯỚC 2.1: LƯU BẢNG MOVIES
            // Kiểm tra phim đã tồn tại chưa
            const checkMovie = await client.query('SELECT id FROM Movies WHERE tmdb_id = $1', [movieData.id]);
            if (checkMovie.rows.length > 0) {
                throw new Error("Phim này đã được thêm vào hệ thống từ trước!"); // Ném lỗi để kích hoạt ROLLBACK
            }

            const insertMovie = await client.query(
                `INSERT INTO Movies (tmdb_id, title, poster_url, overview, duration, status)
                 VALUES ($1, $2, $3, $4, $5, 'Sắp chiếu') RETURNING id`,
                [
                    movieData.id,
                    movieData.title,
                    `https://image.tmdb.org/t/p/w500${movieData.poster_path}`,
                    movieData.overview,
                    movieData.runtime || 120 // Nếu phim chưa có thời lượng, mặc định 120p
                ]
            );
            const newMovieId = insertMovie.rows[0].id;

            // BƯỚC 2.2: LƯU BẢNG GENRES VÀ MOVIE_GENRES
            for (const genre of movieData.genres) {
                let genreId;
                // Tìm xem thể loại (VD: Hành động) đã có trong DB chưa
                const checkGenre = await client.query('SELECT id FROM Genres WHERE name = $1', [genre.name]);
                
                if (checkGenre.rows.length > 0) {
                    genreId = checkGenre.rows[0].id; // Có rồi thì lấy id cũ
                } else {
                    const insertGenre = await client.query('INSERT INTO Genres (name) VALUES ($1) RETURNING id', [genre.name]);
                    genreId = insertGenre.rows[0].id; // Chưa có thì tạo mới và lấy id
                }
                
                // Móc nối Phim và Thể loại vào bảng trung gian N-N
                await client.query('INSERT INTO Movie_Genres (movie_id, genre_id) VALUES ($1, $2)', [newMovieId, genreId]);
            }

            // BƯỚC 2.3: LƯU BẢNG ACTORS VÀ MOVIE_ACTORS
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
                
                // Móc nối Phim và Diễn viên vào bảng trung gian
                await client.query(
                    'INSERT INTO Movie_Actors (movie_id, actor_id, character_name) VALUES ($1, $2, $3)', 
                    [newMovieId, actorId, actor.character]
                );
            }

            // 3. CHỐT GIAO DỊCH VÀ LƯU VĨNH VIỄN
            await client.query('COMMIT'); 

            res.status(201).json({
                message: "Đã kéo và lưu phim vào CSDL PostgreSQL thành công!",
                movie_id: newMovieId
            });

        } catch (error) {
            // CÓ BẤT KỲ LỖI NÀO (Kể cả lỗi do ném ra ở trên) -> HỦY TOÀN BỘ
            await client.query('ROLLBACK');
            console.error("Lỗi:", error.message);
            res.status(400).json({ message: error.message || "Lỗi máy chủ khi lưu phim" });
        } finally {
            // LUÔN LUÔN trả kết nối lại cho hồ bơi (Dù thành công hay thất bại)
            client.release();
        }
    }
};

module.exports = movieController;