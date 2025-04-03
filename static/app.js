document.addEventListener('DOMContentLoaded', function() {
    const loginFormContainer = document.getElementById('loginFormContainer');
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const reportFormContainer = document.getElementById('reportFormContainer');
    const reportForm = document.getElementById('reportForm');
    const registerFormContainer = document.getElementById('registerFormContainer');
    const logoutButton = document.getElementById('logoutButton');
    const logoutContainer = document.getElementById('logoutContainer');
    const viewToggleContainer = document.getElementById('viewToggleContainer');
    const listViewButton = document.getElementById('listViewButton');
    const mapViewButton = document.getElementById('mapViewButton');
    const coordinatesInput = document.getElementById('coordinates');
    const spinner = document.getElementById('spinner');
    const userReportsContainer = document.getElementById('userReportsContainer');
    const userReports = document.getElementById('userReports');
    const mapContainer = document.getElementById('mapContainer');

    let token = '';
    let reports = [];

    const apiBaseUrl = window.location.origin; // Use the Replit assigned URL

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('loginUsername').value;
        const password = document.getElementById('loginPassword').value;

        try {
            const response = await axios.post(`${apiBaseUrl}/token`, `username=${username}&password=${password}`, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            token = response.data.access_token;
            alert('Login successful');
            console.log("Hiding login and register forms, showing report form and logout button");
            loginFormContainer.style.display = 'none';
            registerFormContainer.style.display = 'none';
            reportFormContainer.style.display = 'block';
            logoutContainer.style.display = 'block';
            viewToggleContainer.style.display = 'block';
            userReportsContainer.style.display = 'block';

            // Automatically detect coordinates
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(function(position) {
                    coordinatesInput.value = position.coords.latitude + "," + position.coords.longitude;
                }, function(error) {
                    console.error("Error getting geolocation: ", error);
                });
            } else {
                console.error("Geolocation is not supported by this browser.");
            }

            // Fetch and display user reports
            fetchUserReports();
        } catch (error) {
            console.error("Login failed", error);
            alert('Login failed');
        }
    });

    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('registerUsername').value;
        const email = document.getElementById('registerEmail').value;
        const password = document.getElementById('registerPassword').value;
        const country = document.getElementById('registerCountry').value;
        const postcode = document.getElementById('registerPostcode').value;

        try {
            await axios.post(`${apiBaseUrl}/users/`, {
                username,
                email,
                hashed_password: password,
                country,
                postcode
            }, {
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            alert('Registration successful, please login');
            registerForm.reset();
        } catch (error) {
            console.error("Registration failed", error);
            alert('Registration failed');
        }
    });

    reportForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        spinner.style.display = 'block'; // Show spinner
        const location = document.getElementById('location').value;
        const coordinates = document.getElementById('coordinates').value;
        const materials = Array.from(document.getElementById('materials').selectedOptions).map(option => option.value);
        const notes = document.getElementById('notes').value;
        const photos = document.getElementById('photos').files;

        let photoUrls = [];
        const reportId = uuidv4();  // Generate a unique ID for the report
        for (let i = 0; i < photos.length; i++) {
            const formData = new FormData();
            formData.append('report_id', reportId);  // Include report ID in the form data
            formData.append('file', photos[i]);
            try {
                const uploadResponse = await axios.post(`${apiBaseUrl}/upload-photo/`, formData, {
                    headers: {
                        'Content-Type': 'multipart/form-data'
                    }
                });
                photoUrls.push(uploadResponse.data.file_url);
            } catch (error) {
                console.error("Failed to upload photo", error);
                alert('Failed to upload photo');
                spinner.style.display = 'none'; // Hide spinner if error occurs
                return;
            }
        }

        try {
            await axios.post(`${apiBaseUrl}/reports/`, {
                id: reportId,  // Use the generated report ID
                location,
                coordinates,
                materials,
                notes,
                photos: photoUrls
            }, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            alert('Report submitted successfully');
            reportForm.reset();
            // Reload geolocation coordinates
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(function(position) {
                    coordinatesInput.value = position.coords.latitude + "," + position.coords.longitude;
                }, function(error) {
                    console.error("Error getting geolocation: ", error);
                });
            } else {
                console.error("Geolocation is not supported by this browser.");
            }
            // Fetch and display user reports again
            fetchUserReports();
        } catch (error) {
            console.error("Failed to submit report", error);
            alert('Failed to submit report');
        } finally {
            spinner.style.display = 'none'; // Hide spinner after completion
        }
    });

    listViewButton.addEventListener('click', () => {
        userReportsContainer.style.display = 'block';
        mapContainer.style.display = 'none';
    });

    mapViewButton.addEventListener('click', () => {
        userReportsContainer.style.display = 'none';
        mapContainer.style.display = 'block';
        initMap();
    });

    async function fetchUserReports() {
        try {
            const response = await axios.get(`${apiBaseUrl}/reports/`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            reports = response.data;
            console.log("Fetched reports: ", reports); // Debug log
            userReports.innerHTML = '';
            reports.forEach(report => {
                const reportDiv = document.createElement('div');
                reportDiv.classList.add('w3-card', 'w3-margin', 'w3-padding');
                const photosHtml = report.photos.map(photo => `<img src="${photo}" alt="Photo" width="100">`).join(' ');
                reportDiv.innerHTML = `
                    <h3>Report ID: ${report.id}</h3>
                    <p><strong>Location:</strong> ${report.location}</p>
                    <p><strong>Coordinates:</strong> ${report.coordinates}</p>
                    <p><strong>Materials:</strong> ${report.materials.join(', ')}</p>
                    <p><strong>Notes:</strong> ${report.notes || 'None'}</p>
                    <p><strong>Photos:</strong> ${photosHtml}</p>
                    <button class="w3-button w3-disabled" disabled>Edit</button>
                `;
                userReports.appendChild(reportDiv);
            });
        } catch (error) {
            console.error("Failed to fetch user reports", error);
        }
    }

    async function initMap() {
        // Ensure the map container is visible and ready
        google.maps.event.addDomListenerOnce(window, 'load', () => {
            const map = new google.maps.Map(document.getElementById('map'), {
                zoom: 10,
                center: { lat: 0, lng: 0 },
            });

            const bounds = new google.maps.LatLngBounds();

            reports.forEach(report => {
                const [lat, lng] = report.coordinates.split(',').map(Number);
                const marker = new google.maps.Marker({
                    position: { lat, lng },
                    map: map,
                    title: report.location,
                });

                bounds.extend(marker.getPosition());

                const infoWindow = new google.maps.InfoWindow({
                    content: `
                        <div>
                            <h3>Location: ${report.location}</h3>
                            <p><strong>Materials:</strong> ${report.materials.join(', ')}</p>
                            <p><strong>Notes:</strong> ${report.notes || 'None'}</p>
                            <div>${report.photos.map(photo => `<img src="${photo}" alt="Photo" width="100">`).join(' ')}</div>
                        </div>
                    `,
                });

                marker.addListener('click', () => {
                    infoWindow.open(map, marker);
                });
            });

            map.fitBounds(bounds);
        });
    }

    logoutButton.addEventListener('click', () => {
        token = '';
        console.log("Showing login and register forms, hiding report form and logout button");
        loginFormContainer.style.display = 'block';
        registerFormContainer.style.display = 'block';
        reportFormContainer.style.display = 'none';
        logoutContainer.style.display = 'none';
        viewToggleContainer.style.display = 'none';
        userReportsContainer.style.display = 'none';
        mapContainer.style.display = 'none';
        alert('Logged out successfully');
    });

    // Function to generate a UUIDv4 string
    function uuidv4() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0,
                  v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
});
