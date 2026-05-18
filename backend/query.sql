SELECT title, company, LEFT(description, 200) FROM jobs WHERE title LIKE '%node%' OR title LIKE '%full stack%' ORDER BY createdat DESC LIMIT 5;
