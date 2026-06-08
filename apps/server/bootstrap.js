const { join } = require('path')
const { Bootstrap } = require('@midwayjs/bootstrap')
Bootstrap.configure({
  baseDir: join(__dirname, 'dist'),
}).run()
