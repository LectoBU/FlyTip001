from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form
from starlette import status
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel
from typing import List, Optional
from replit import db
from passlib.context import CryptContext
from datetime import datetime, timedelta
from jose import JWTError, jwt
from uuid import uuid4
import os
from PIL import Image
import io
import json

# Constants
SECRET_KEY = os.getenv("SECRET_KEY", "your_secret_key")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

app = FastAPI()

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

app.mount("/static", StaticFiles(directory="static"), name="static")

# Create folder for uploaded pictures if it doesn't exist
os.makedirs("static/tip_pictures", exist_ok=True)

class User(BaseModel):
    username: str
    email: str
    hashed_password: str
    country: Optional[str] = None
    postcode: Optional[str] = None
    communities: List[str] = []

class UserInDB(User):
    hashed_password: str

class FlyTippingReportRequest(BaseModel):
    location: str
    coordinates: str
    materials: List[str]
    notes: Optional[str] = None
    photos: List[str]

class FlyTippingReport(BaseModel):
    id: str
    user: str
    location: str
    coordinates: str
    materials: List[str]
    notes: Optional[str] = None
    timestamp: datetime
    photos: List[str]

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    username: Optional[str] = None

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
        token_data = TokenData(username=username)
    except JWTError:
        raise credentials_exception
    user_dict = db.get(token_data.username)
    if user_dict is None:
        raise credentials_exception
    return UserInDB(**user_dict)

@app.post("/token", response_model=Token)
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends()):
    user_dict = db.get(form_data.username)
    if not user_dict:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = UserInDB(**user_dict)
    if not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@app.post("/users/", response_model=User)
async def create_user(user: User):
    if db.get(user.username):
        raise HTTPException(status_code=400, detail="Username already registered")
    hashed_password = get_password_hash(user.hashed_password)
    user_data = user.dict()
    user_data['hashed_password'] = hashed_password
    db[user.username] = user_data
    return user

@app.get("/users/me/", response_model=User)
async def read_users_me(current_user: User = Depends(get_current_user)):
    return current_user

@app.put("/users/me/", response_model=User)
async def update_user_me(user: User, current_user: User = Depends(get_current_user)):
    current_user_data = current_user.dict()
    current_user_data.update(user.dict(exclude_unset=True))
    db[current_user.username] = current_user_data
    return User(**current_user_data)

@app.post("/upload-photo/")
async def upload_photo(report_id: str = Form(...), file: UploadFile = File(...)):
    image = Image.open(file.file)
    output = io.BytesIO()

    # Auto-rotate the image based on EXIF orientation
    try:
        exif = image._getexif()
        if exif:
            orientation_key = 274  # cf. ExifTags
            if orientation_key in exif:
                orientation = exif[orientation_key]
                rotate_values = {3: 180, 6: 270, 8: 90}
                if orientation in rotate_values:
                    image = image.rotate(rotate_values[orientation], expand=True)
    except AttributeError:
        # If there's no EXIF data, just continue
        pass

    # Resize image to be smaller and convert to low-quality JPEG
    image = image.convert("RGB")
    image.thumbnail((400, 400))
    image.save(output, format="JPEG", quality=60)
    output.seek(0)

    # Save the image to the specified folder with a unique name
    filename = f"{report_id}_{file.filename}"
    file_location = f"static/tip_pictures/{filename}"
    with open(file_location, "wb") as f:
        f.write(output.read())

    return {"file_url": f"/static/tip_pictures/{filename}"}


@app.post("/reports/", response_model=FlyTippingReport)
async def create_report(report: FlyTippingReportRequest, current_user: User = Depends(get_current_user)):
    new_report = FlyTippingReport(
        id=f"report_{str(uuid4())}",
        user=current_user.username,
        location=report.location,
        coordinates=report.coordinates,
        materials=report.materials,
        notes=report.notes,
        timestamp=datetime.utcnow(),
        photos=report.photos
    )
    db[new_report.id] = json.loads(new_report.json())
    return new_report

@app.get("/reports/", response_model=List[FlyTippingReport])
async def get_reports(current_user: User = Depends(get_current_user)):
    reports = []
    for key in db.prefix('report_'):
        report_data = db[key]
        report = FlyTippingReport(**report_data)
        if report.user == current_user.username:
            reports.append(report)
    return reports

@app.get("/reports/{report_id}", response_model=FlyTippingReport)
async def get_report(report_id: str, current_user: User = Depends(get_current_user)):
    report_data = db.get(report_id)
    if not report_data:
        raise HTTPException(status_code=404, detail="Report not found")
    report = FlyTippingReport(**report_data)
    if report.user != current_user.username:
        raise HTTPException(status_code=403, detail="Not authorized to view this report")
    return report

@app.put("/reports/{report_id}", response_model=FlyTippingReport)
async def update_report(report_id: str, updated_report: FlyTippingReportRequest, current_user: User = Depends(get_current_user)):
    report_data = db.get(report_id)
    if not report_data:
        raise HTTPException(status_code=404, detail="Report not found")
    report = FlyTippingReport(**report_data)
    if report.user != current_user.username:
        raise HTTPException(status_code=403, detail="Not authorized to update this report")
    report.location = updated_report.location
    report.coordinates = updated_report.coordinates
    report.materials = updated_report.materials
    report.notes = updated_report.notes
    report.photos = updated_report.photos
    db[report.id] = json.loads(report.json())
    return report

@app.get("/static/tip_pictures/{filename}")
async def get_uploaded_photo(filename: str):
    file_path = f"static/tip_pictures/{filename}"
    return FileResponse(path=file_path, filename=filename)

# Serve the static files
app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
