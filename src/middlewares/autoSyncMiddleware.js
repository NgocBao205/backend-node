const pool = require('../config/db');

/**
 * Middleware: Tự động cập nhật vòng đời Movies & Showtimes trong Database theo giờ thực tế Việt Nam (Asia/Ho_Chi_Minh)
 * Nguyên lý "Kiểm tra trước khi hiển thị":
 * 1. Với Phim (Movies):
 *    - Phim đang có trạng thái 'Sắp chiếu' mà ngày khởi chiếu release_date <= ngày hiện tại (giờ VN)
 *      -> Tự động cập nhật thành 'Đang chiếu'.
 * 2. Với Suất Chiếu (Showtimes):
 *    - Suất chiếu không phải 'Hủy' mà giờ VN hiện tại >= start_time AND giờ VN hiện tại < end_time
 *      và status = 'Sắp chiếu' -> Tự động chuyển thành 'Đang chiếu'.
 *    - Suất chiếu không phải 'Hủy' mà giờ VN hiện tại >= end_time
 *      và status IN ('Sắp chiếu', 'Đang chiếu') -> Tự động chuyển thành 'Đã chiếu'.
 */
let lastSyncTimestamp = 0;
const SYNC_INTERVAL_MS = 5000; // Throttle 5s

const autoSyncStatus = async (req, res, next) => {
    const now = Date.now();
    // Bỏ qua nếu lần quét trước vừa diễn ra cách đây chưa tới 5 giây
    if (now - lastSyncTimestamp < SYNC_INTERVAL_MS) {
        return next();
    }

    try {
        lastSyncTimestamp = now;

        // 1. Cập nhật Phim: Sắp chiếu -> Đang chiếu (dựa trên múi giờ Việt Nam)
        const updateMoviesQuery = `
            UPDATE Movies 
            SET status = 'Đang chiếu' 
            WHERE status = 'Sắp chiếu' 
              AND release_date IS NOT NULL 
              AND release_date <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
        `;

        // 2. Cập nhật Suất chiếu:
        // 2a. Sắp chiếu -> Đang chiếu (khi giờ hiện tại nằm giữa start_time và end_time)
        const updateStartingShowtimesQuery = `
            UPDATE Showtimes 
            SET status = 'Đang chiếu' 
            WHERE status = 'Sắp chiếu' 
              AND start_time <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::timestamp
              AND end_time > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::timestamp
        `;

        // 2b. Sắp chiếu / Đang chiếu -> Đã chiếu (khi giờ hiện tại đã qua end_time)
        const updateFinishedShowtimesQuery = `
            UPDATE Showtimes 
            SET status = 'Đã chiếu' 
            WHERE status IN ('Sắp chiếu', 'Đang chiếu') 
              AND end_time <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::timestamp
        `;

        await Promise.all([
            pool.query(updateMoviesQuery),
            pool.query(updateStartingShowtimesQuery),
            pool.query(updateFinishedShowtimesQuery)
        ]);

        next();
    } catch (error) {
        console.error("Lỗi tự động đồng bộ trạng thái Phim/Suất Chiếu:", error.message);
        next();
    }
};

/**
 * Hàm gọi trực tiếp (manual run) khi cần ép buộc đồng bộ ngay lập tức
 */
const syncNow = async () => {
    try {
        const queryFunc = pool.queryWithRetry || pool.query.bind(pool);
        await Promise.all([
            queryFunc(`
                UPDATE Movies 
                SET status = 'Đang chiếu' 
                WHERE status = 'Sắp chiếu' 
                  AND release_date IS NOT NULL 
                  AND release_date <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
            `),
            queryFunc(`
                UPDATE Showtimes 
                SET status = 'Đang chiếu' 
                WHERE status = 'Sắp chiếu' 
                  AND start_time <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::timestamp
                  AND end_time > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::timestamp
            `),
            queryFunc(`
                UPDATE Showtimes 
                SET status = 'Đã chiếu' 
                WHERE status IN ('Sắp chiếu', 'Đang chiếu') 
                  AND end_time <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::timestamp
            `)
        ]);
    } catch (err) {
        if (!err.message?.includes('ECONNRESET')) {
            console.error("Lỗi syncNow:", err.message);
        }
    }
};

module.exports = {
    autoSyncStatus,
    syncNow
};
