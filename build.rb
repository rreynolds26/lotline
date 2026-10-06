# Assembles index.html from src/shell.html + src/app.js + src/county.js + src/schema.json.
# Usage: ruby build.rb
require 'json'
Dir.chdir(__dir__)
rd = ->(p) { File.read(p, encoding: 'UTF-8') }
schema = JSON.generate(JSON.parse(rd.('src/schema.json')))
app = rd.('src/app.js').sub('/*SCHEMA*/null') { schema }.sub('/*COUNTY*/') { rd.('src/county.js') }
out = rd.('src/shell.html').sub('/*APP*/') { app }
File.write('index.html', out, encoding: 'UTF-8')
puts "index.html: #{out.bytesize} bytes"
