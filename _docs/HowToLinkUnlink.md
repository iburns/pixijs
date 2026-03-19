```
-- To remove the link from the pixi library itself
npm unlink -g

-- To globally link it
npm link

-- In consumer project
npm link pixi.js

-- To check global links
npm ls -g --link=true
```

if you get more weirdness, trying deleting the \lib\ folder from this project and then building again
