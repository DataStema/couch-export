#!/bin/bash

SEM_VER='2.0.0'
IMG_NAME='datastemalux/couch-export'
GIT_REF='84e3441'

docker image build --no-cache=true \
             --build-arg BUILD_DATE=$(date -u +'%Y-%m-%dT%H:%M:%SZ') \
             --build-arg BUILD_VERSION='v'$SEM_VER \
             --build-arg GIT_REF=$GIT_REF \
             --build-arg IMG_NAME=$IMG_NAME \
             --tag $IMG_NAME:latest .

docker tag $IMG_NAME:latest $IMG_NAME:$SEM_VER

docker push $IMG_NAME:$SEM_VER
docker push $IMG_NAME:latest
